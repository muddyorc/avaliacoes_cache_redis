// Preparo do banco para os testes automatizados (DT21).
//
// Estes helpers APAGAM dados. Por isso a primeira coisa que fazem é conferir que estão
// falando com o banco de teste. Se `npm test` for contornado e os testes rodarem sem
// NODE_ENV=test, a checagem aborta antes de qualquer DELETE.
import bcrypt from 'bcryptjs';
import { pool, query } from '../../src/db/pool.js';
import { env } from '../../src/config/env.js';
import { migrar } from '../../src/db/migrate.js';
import { semear } from '../../src/db/seed.js';

// Ordem irrelevante por causa do CASCADE, mas a lista explícita documenta o alcance.
const TABELAS_DE_DADOS = [
  'registro_acesso',
  'token_redefinicao_senha',
  'evento_monitoramento',
  'resposta',
  'tentativa',
  'avaliacao_turma',
  'avaliacao_questao',
  'avaliacao',
  'alternativa',
  'questao',
  'turma_estudante',
  'turma',
  'usuario',
];

export function exigirBancoDeTeste() {
  if (env.nodeEnv !== 'test') {
    throw new Error(
      `Os testes só podem rodar com NODE_ENV=test (atual: "${env.nodeEnv}"). Use "npm test".`,
    );
  }
  if (!process.env.DATABASE_URL_TESTE || env.databaseUrl !== process.env.DATABASE_URL_TESTE) {
    throw new Error('Os testes não estão conectados a DATABASE_URL_TESTE. Use "npm test".');
  }
  if (env.databaseUrl === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TESTE é igual a DATABASE_URL: os testes apagariam o banco de desenvolvimento.');
  }
}

// Zera os dados e recria o administrador inicial. `RESTART IDENTITY` mantém os ids
// previsíveis entre execuções.
export async function limparDados() {
  exigirBancoDeTeste();
  await query(`TRUNCATE TABLE ${TABELAS_DE_DADOS.join(', ')} RESTART IDENTITY CASCADE`);
  await semear({ silencioso: true });
}

export async function prepararBanco() {
  exigirBancoDeTeste();
  await migrar({ silencioso: true });
  await limparDados();
}

export async function encerrarBanco() {
  await pool.end();
}

// Cria um usuário de teste com senha em hash real (bcrypt), como o sistema faria.
export async function criarUsuario({ nome, email, senha, perfil, situacao = 'ATIVO' }) {
  const { rows } = await query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil, situacao)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nome, email, perfil, situacao`,
    [nome, email, await bcrypt.hash(senha, 10), perfil, situacao],
  );
  return rows[0];
}

// Extrai o valor de um cookie do cabeçalho Set-Cookie de uma resposta do supertest.
export function lerCookie(resposta, nome) {
  const cabecalhos = resposta.headers['set-cookie'] || [];
  const bruto = cabecalhos.find((c) => c.startsWith(`${nome}=`));
  if (!bruto) return null;
  return {
    bruto,
    valor: bruto.slice(nome.length + 1).split(';')[0],
    httpOnly: /;\s*HttpOnly/i.test(bruto),
    sameSite: (bruto.match(/;\s*SameSite=([^;]+)/i) || [])[1],
    secure: /;\s*Secure/i.test(bruto),
  };
}

// Vincula a avaliação a uma turma nova, com os estudantes já aprovados nela.
//
// Existe por causa da reversão do P-19 (13/10/2026): enquanto houve avaliação PÚBLICA,
// vários testes a usavam como atalho para não precisar montar turma — a prova ficava
// aberta a qualquer estudante cadastrado. Sem essa saída, TODA avaliação precisa de
// turma, inclusive para ser publicada.
//
// Direto no banco, e não pela API: isto é preparo de cenário, não o que está sob teste.
// Montar por HTTP exigiria criar turma, pedir entrada com cada estudante e aprovar um a
// um — muitas requisições para chegar ao estado que o teste quer como ponto de partida.
//
// Precisa ser chamado ANTES de publicar: publicar sem turma passou a ser recusado.
export async function vincularTurmaComEstudantes(avaliacaoId, emails = []) {
  const { rows: dona } = await query('SELECT professor_id FROM avaliacao WHERE id = $1', [avaliacaoId]);
  if (!dona[0]) throw new Error(`Avaliação ${avaliacaoId} não existe: confira a ordem do preparo.`);

  // Código curto e único por turma: a coluna é UNIQUE e o mesmo teste pode criar várias.
  const codigo = `T${String(Date.now()).slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  const { rows: turma } = await query(
    `INSERT INTO turma (professor_id, nome, codigo_acesso, requer_aprovacao)
     VALUES ($1, $2, $3, FALSE) RETURNING id`,
    [dona[0].professor_id, `Turma de teste ${codigo}`, codigo],
  );
  const turmaId = turma[0].id;

  for (const email of emails) {
    const { rowCount } = await query(
      `INSERT INTO turma_estudante (turma_id, estudante_id, situacao, decidido_em)
       SELECT $1, u.id, 'APROVADA', now() FROM usuario u WHERE lower(u.email) = lower($2)
       ON CONFLICT (turma_id, estudante_id) DO NOTHING`,
      [turmaId, email],
    );
    // Falha barulhenta: um e-mail errado deixaria o estudante fora da turma, e o teste
    // quebraria depois, no "iniciar", com uma mensagem que não aponta para a causa.
    if (rowCount === 0) throw new Error(`Estudante "${email}" não encontrado ao montar a turma de teste.`);
  }

  await query(
    `INSERT INTO avaliacao_turma (avaliacao_id, turma_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [avaliacaoId, turmaId],
  );
  return turmaId;
}
