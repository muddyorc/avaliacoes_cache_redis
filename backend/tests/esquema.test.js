// Etapa 0 — o esquema existe e as regras garantidas pelo BANCO funcionam.
// Tudo roda dentro de uma transação desfeita ao final: o banco de desenvolvimento não é alterado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';
import { migrar } from '../src/db/migrate.js';
import { semear } from '../src/db/seed.js';
import { env } from '../src/config/env.js';

const TABELAS = [
  'usuario', 'registro_acesso', 'token_redefinicao_senha',
  'turma', 'turma_estudante',
  'questao', 'alternativa',
  'avaliacao', 'avaliacao_questao', 'avaliacao_turma',
  'tentativa', 'resposta', 'evento_monitoramento',
  'schema_migrations',
];

let client;

before(async () => {
  await migrar({ silencioso: true });
  await semear({ silencioso: true });
  client = await pool.connect();
  await client.query('BEGIN');
});

after(async () => {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
});

// Executa um comando que DEVE falhar, sem abortar a transação principal.
async function deveFalhar(sql, params, trechoEsperado) {
  await client.query('SAVEPOINT tentativa_falha');
  try {
    await client.query(sql, params);
    assert.fail(`O comando deveria ter falhado: ${sql}`);
  } catch (erro) {
    if (erro.code === 'ERR_ASSERTION') throw erro;
    assert.match(`${erro.constraint ?? ''} ${erro.message}`, trechoEsperado);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT tentativa_falha');
  }
}

async function inserir(sql, params) {
  const { rows } = await client.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

test('todas as tabelas do modelo existem', async () => {
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const existentes = rows.map((r) => r.table_name);
  for (const tabela of TABELAS) {
    assert.ok(existentes.includes(tabela), `tabela ausente: ${tabela}`);
  }
});

test('administrador inicial existe com senha em hash bcrypt (nunca texto puro)', async () => {
  const { rows } = await client.query(
    "SELECT email, senha_hash, situacao FROM usuario WHERE perfil = 'ADMINISTRADOR'",
  );
  assert.ok(rows.length >= 1);
  const admin = rows[0];
  assert.equal(admin.situacao, 'ATIVO');
  assert.notEqual(admin.senha_hash, env.admin.senha);
  assert.match(admin.senha_hash, /^\$2[aby]\$/);
  if (admin.email === env.admin.email.toLowerCase()) {
    assert.ok(await bcrypt.compare(env.admin.senha, admin.senha_hash));
  }
});

test('regras de integridade garantidas pelo banco', async (t) => {
  const professor = await inserir(
    "INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Prof', 'prof.teste@exemplo.com', 'x', 'PROFESSOR')",
  );
  const estudante = await inserir(
    "INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Est', 'est.teste@exemplo.com', 'x', 'ESTUDANTE')",
  );

  await t.test('e-mail é único sem diferenciar maiúsculas', () =>
    deveFalhar(
      "INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('Outro', 'PROF.TESTE@exemplo.com', 'x', 'PROFESSOR')",
      [], /usuario_email_unico/,
    ));

  await t.test('perfil fora dos três permitidos é recusado (P-17)', () =>
    deveFalhar(
      "INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES ('X', 'x@exemplo.com', 'x', 'COORDENADOR')",
      [], /perfil_check/,
    ));

  const questao = await inserir(
    "INSERT INTO questao (professor_id, tipo, enunciado, pontuacao_padrao) VALUES ($1, 'OBJETIVA', 'Quanto é 2+2?', 1)",
    [professor],
  );
  await inserir("INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, 1, '4', true)", [questao]);
  await inserir("INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, 2, '5', false)", [questao]);

  // A P-13 ("no máximo uma correta") era garantida por índice parcial. A P-26 (10/10/2026)
  // tornou a regra dependente do tipo de resposta da questão, que vive em OUTRA tabela —
  // e índice parcial não enxerga coluna de tabela vizinha. O índice saiu na migração 009 e
  // a garantia foi para a aplicação (DT82).
  //
  // Este teste existe para que a perda seja explícita: se alguém reintroduzir o índice
  // sem perceber, a questão de múltipla escolha para de poder ser salva.
  await t.test('o banco aceita duas corretas: a regra agora depende do tipo da questão (P-26)', async () => {
    const segunda = await inserir(
      "INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, 3, '22', true)",
      [questao],
    );
    assert.ok(segunda, 'o índice alternativa_uma_correta não deve existir mais');
    await client.query('DELETE FROM alternativa WHERE id = $1', [segunda]);
  });

  await t.test('período da avaliação exige fim depois do início (P-05)', () =>
    deveFalhar(
      `INSERT INTO avaliacao (professor_id, titulo, duracao_minutos, data_inicio, data_fim)
       VALUES ($1, 'Inválida', 30, now(), now() - interval '1 hour')`,
      [professor], /avaliacao_check/,
    ));

  const avaliacao = await inserir(
    `INSERT INTO avaliacao (professor_id, titulo, duracao_minutos, data_inicio, data_fim)
     VALUES ($1, 'Prova 1', 30, now(), now() + interval '1 day')`,
    [professor],
  );
  await client.query(
    'INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, 1, 2)',
    [avaliacao, questao],
  );

  await t.test('mesma questão pode ser reutilizada em outra avaliação (P-01)', async () => {
    const outra = await inserir(
      `INSERT INTO avaliacao (professor_id, titulo, duracao_minutos, data_inicio, data_fim)
       VALUES ($1, 'Prova 2', 30, now(), now() + interval '1 day')`,
      [professor],
    );
    await client.query(
      'INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, 1, 3)',
      [outra, questao],
    );
  });

  const tentativa = await inserir(
    "INSERT INTO tentativa (avaliacao_id, estudante_id, prazo_final) VALUES ($1, $2, now() + interval '30 minutes')",
    [avaliacao, estudante],
  );

  await t.test('uma única tentativa por estudante por avaliação (P-04)', () =>
    deveFalhar(
      "INSERT INTO tentativa (avaliacao_id, estudante_id, prazo_final) VALUES ($1, $2, now())",
      [avaliacao, estudante], /tentativa_unica_por_estudante/,
    ));

  await t.test('tentativa bloqueada exige motivo registrado (P-06)', () =>
    deveFalhar(
      "UPDATE tentativa SET status = 'BLOQUEADA', finalizada_em = now() WHERE id = $1",
      [tentativa], /tentativa_check/,
    ));

  await t.test('uma resposta por questão por tentativa (base do autosave)', async () => {
    await client.query(
      'INSERT INTO resposta (tentativa_id, questao_id, texto) VALUES ($1, $2, $3)',
      [tentativa, questao, 'rascunho'],
    );
    await deveFalhar(
      'INSERT INTO resposta (tentativa_id, questao_id, texto) VALUES ($1, $2, $3)',
      [tentativa, questao, 'duplicada'], /resposta_unica_por_questao/,
    );
  });

  await t.test('tipo de evento de monitoramento restrito à lista prevista (RF10)', () =>
    deveFalhar(
      "INSERT INTO evento_monitoramento (tentativa_id, tipo) VALUES ($1, 'FRAUDE')",
      [tentativa], /evento_monitoramento_tipo_check/,
    ));
});
