// Etapa 3 — RF05: banco de questões (UC05, P-03, P-13, P-22, Quadro 31).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { criarUsuario, encerrarBanco, limparDados, prepararBanco } from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const PROF = { nome: 'Prof. A', email: 'prof.a@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const OUTRO_PROF = { nome: 'Prof. B', email: 'prof.b@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ESTUDANTE = { nome: 'Est.', email: 'est@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };

const OBJETIVA = {
  tipo: 'OBJETIVA',
  enunciado: 'Quanto é 2 + 2?',
  tema: 'Aritmética',
  pontuacaoPadrao: 1,
  alternativas: [
    { texto: '3', correta: false },
    { texto: '4', correta: true },
    { texto: '5', correta: false },
  ],
};

const DISCURSIVA = {
  tipo: 'DISCURSIVA',
  enunciado: 'Explique o que é uma chave estrangeira.',
  tema: 'Banco de Dados',
  pontuacaoPadrao: 2.5,
  respostaEsperada: 'Coluna que referencia a chave primária de outra tabela.',
  criteriosCorrecao: 'Citar referência; citar integridade referencial.',
};

let idProf;
let idEstudante;

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  idProf = (await criarUsuario(PROF)).id;
  await criarUsuario(OUTRO_PROF);
  idEstudante = (await criarUsuario(ESTUDANTE)).id;
  await criarUsuario(ADMIN);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  const resposta = await agente.post('/api/auth/login').send({ email, senha: SENHA });
  assert.equal(resposta.status, 200);
  return agente;
}

async function criarQuestao(agente, dados = OBJETIVA) {
  const resposta = await agente.post('/api/questoes').send(dados);
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));
  return resposta.body.questao;
}

// Monta no banco o que as Etapas 4 e 6 ainda não criam pela API: uma avaliação que
// contém a questão, opcionalmente publicada e opcionalmente já iniciada por um estudante.
async function colocarEmAvaliacao(questaoId, { status = 'RASCUNHO', comTentativa = false } = {}) {
  const { rows } = await query(
    `INSERT INTO avaliacao (professor_id, titulo, duracao_minutos, data_inicio, data_fim, status)
     VALUES ($1, 'Prova', 30, now(), now() + interval '1 day', $2) RETURNING id`,
    [idProf, status],
  );
  const avaliacaoId = rows[0].id;
  await query('INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, 1, 1)', [
    avaliacaoId,
    questaoId,
  ]);
  if (comTentativa) {
    await query(
      "INSERT INTO tentativa (avaliacao_id, estudante_id, prazo_final) VALUES ($1, $2, now() + interval '30 minutes')",
      [avaliacaoId, idEstudante],
    );
    // Prova aplicada é prova congelada: é o que o sistema faz no primeiro início
    // (migração 004). O fluxo real está coberto em tests/congelamento.test.js.
    await query(
      `UPDATE avaliacao_questao aq
          SET enunciado = q.enunciado, tipo = q.tipo, tema = q.tema,
              resposta_esperada = q.resposta_esperada, criterios_correcao = q.criterios_correcao,
              congelada_em = now()
         FROM questao q WHERE q.id = aq.questao_id AND aq.avaliacao_id = $1`,
      [avaliacaoId],
    );
    await query(
      `INSERT INTO avaliacao_alternativa (avaliacao_id, questao_id, origem_id, ordem, texto, correta)
       SELECT aq.avaliacao_id, aq.questao_id, al.id, al.ordem, al.texto, al.correta
         FROM avaliacao_questao aq JOIN alternativa al ON al.questao_id = aq.questao_id
        WHERE aq.avaliacao_id = $1`,
      [avaliacaoId],
    );
  }
  return avaliacaoId;
}

// ------------------------------------------------------------------- acesso por perfil

test('somente o professor acessa o banco de questões (Quadro 31)', async () => {
  assert.equal((await request(app).get('/api/questoes')).status, 401);
  assert.equal((await (await entrar(ESTUDANTE.email)).get('/api/questoes')).status, 403);
  assert.equal((await (await entrar(ADMIN.email)).get('/api/questoes')).status, 403);
  assert.equal((await (await entrar(PROF.email)).get('/api/questoes')).status, 200);
});

test('estudante não consegue criar questão nem ler o gabarito', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  const estudante = await entrar(ESTUDANTE.email);

  assert.equal((await estudante.post('/api/questoes').send(OBJETIVA)).status, 403);
  assert.equal((await estudante.get(`/api/questoes/${questao.id}`)).status, 403);
});

// ------------------------------------------------------------------------- criação

test('professor cria questão objetiva com alternativas e gabarito', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  assert.equal(questao.tipo, 'OBJETIVA');
  assert.equal(questao.situacao, 'ATIVA');
  assert.equal(questao.pontuacaoPadrao, 1);
  assert.deepEqual(questao.alternativas.map((a) => [a.ordem, a.texto, a.correta]), [
    [1, '3', false],
    [2, '4', true],
    [3, '5', false],
  ]);
  // Objetiva não guarda campos de discursiva.
  assert.equal(questao.respostaEsperada, null);
  assert.equal(questao.criteriosCorrecao, null);
});

test('verdadeiro/falso é uma objetiva de duas alternativas (P-03)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof, {
    tipo: 'OBJETIVA',
    enunciado: 'O PostgreSQL é um banco relacional.',
    pontuacaoPadrao: 1,
    alternativas: [
      { texto: 'Verdadeiro', correta: true },
      { texto: 'Falso', correta: false },
    ],
  });
  assert.equal(questao.alternativas.length, 2);
});

test('professor cria questão discursiva com resposta esperada e critérios', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof, DISCURSIVA);

  assert.equal(questao.tipo, 'DISCURSIVA');
  assert.equal(questao.pontuacaoPadrao, 2.5);
  assert.equal(questao.respostaEsperada, DISCURSIVA.respostaEsperada);
  assert.equal(questao.criteriosCorrecao, DISCURSIVA.criteriosCorrecao);
  assert.deepEqual(questao.alternativas, []);
});

test('critérios de correção são opcionais na discursiva', async () => {
  const prof = await entrar(PROF.email);
  const { criteriosCorrecao: _removido, ...semCriterios } = DISCURSIVA;
  const questao = await criarQuestao(prof, semCriterios);
  assert.equal(questao.criteriosCorrecao, null);
});

// ---------------------------------------------------------------------- validações

test('objetiva sem nenhuma alternativa correta é recusada (P-13)', async () => {
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send({
    ...OBJETIVA,
    alternativas: OBJETIVA.alternativas.map((a) => ({ ...a, correta: false })),
  });

  assert.equal(resposta.status, 400);
  assert.match(resposta.body.campos.alternativas, /exatamente uma/i);
});

// A P-13 ("uma correta, sem múltiplas") foi revogada pela P-26 em 10/10/2026. A recusa
// continua existindo, mas agora ela é do **tipo de resposta** da questão: quem quiser duas
// corretas declara isso na questão, e a mensagem diz como.
test('objetiva de resposta única com duas corretas é recusada, e a mensagem ensina a saída', async () => {
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send({
    ...OBJETIVA,
    alternativas: OBJETIVA.alternativas.map((a) => ({ ...a, correta: true })),
  });

  assert.equal(resposta.status, 400);
  assert.match(resposta.body.campos.alternativas, /Mais de uma alternativa correta/);
});

test('objetiva precisa de pelo menos 2 e no máximo 10 alternativas', async () => {
  const prof = await entrar(PROF.email);

  const uma = await prof.post('/api/questoes').send({ ...OBJETIVA, alternativas: [{ texto: 'Única', correta: true }] });
  assert.equal(uma.status, 400);
  assert.match(uma.body.campos.alternativas, /pelo menos 2/i);

  const muitas = Array.from({ length: 11 }, (_, i) => ({ texto: `Opção ${i}`, correta: i === 0 }));
  const onze = await prof.post('/api/questoes').send({ ...OBJETIVA, alternativas: muitas });
  assert.equal(onze.status, 400);
  assert.match(onze.body.campos.alternativas, /no máximo 10/i);
});

test('alternativas com o mesmo texto são recusadas', async () => {
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send({
    ...OBJETIVA,
    alternativas: [
      { texto: '4', correta: true },
      { texto: ' 4 ', correta: false },
    ],
  });

  assert.equal(resposta.status, 400);
  assert.match(resposta.body.campos.alternativas, /mesmo texto/i);
});

test('discursiva sem resposta esperada é aceita (P-03 revista)', async () => {
  // Nem todo professor tem resposta-modelo pronta. Quando ela falta, a correção
  // assistida avalia pelo enunciado, pelo tema e pelos critérios.
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send({ ...DISCURSIVA, respostaEsperada: '  ' });

  assert.equal(resposta.status, 201);
  assert.equal(resposta.body.questao.respostaEsperada, null, 'campo em branco é guardado como nulo');
  assert.equal(resposta.body.questao.tipo, 'DISCURSIVA');
});

test('discursiva com resposta esperada continua guardando a referência', async () => {
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send(DISCURSIVA);
  assert.equal(resposta.status, 201);
  assert.equal(resposta.body.questao.respostaEsperada, DISCURSIVA.respostaEsperada);
});

test('discursiva com alternativas é recusada', async () => {
  const prof = await entrar(PROF.email);
  const resposta = await prof.post('/api/questoes').send({ ...DISCURSIVA, alternativas: OBJETIVA.alternativas });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.alternativas);
});

test('enunciado vazio, pontuação inválida e tipo desconhecido são recusados', async () => {
  const prof = await entrar(PROF.email);

  const semEnunciado = await prof.post('/api/questoes').send({ ...OBJETIVA, enunciado: '   ' });
  assert.ok(semEnunciado.body.campos.enunciado);

  for (const pontuacaoPadrao of [0, -1, 1.234, 'abc']) {
    const resposta = await prof.post('/api/questoes').send({ ...OBJETIVA, pontuacaoPadrao });
    assert.equal(resposta.status, 400, `pontuação ${pontuacaoPadrao} deveria ser recusada`);
    assert.ok(resposta.body.campos.pontuacaoPadrao);
  }

  const tipo = await prof.post('/api/questoes').send({ ...OBJETIVA, tipo: 'MULTIPLA' });
  assert.ok(tipo.body.campos.tipo);
});

// ----------------------------------------------------------------------- propriedade

test('um professor não vê nem altera as questões de outro', async () => {
  const dono = await entrar(PROF.email);
  const questao = await criarQuestao(dono);
  const outro = await entrar(OUTRO_PROF.email);

  // 404 (e não 403) para não revelar que a questão existe.
  assert.equal((await outro.get(`/api/questoes/${questao.id}`)).status, 404);
  assert.equal((await outro.put(`/api/questoes/${questao.id}`).send(OBJETIVA)).status, 404);
  assert.equal((await outro.post(`/api/questoes/${questao.id}/duplicar`)).status, 404);
  assert.equal((await outro.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' })).status, 404);

  const lista = await outro.get('/api/questoes');
  assert.equal(lista.body.total, 0);

  // E a questão continua intacta para o dono.
  const { rows } = await query('SELECT situacao, enunciado FROM questao WHERE id = $1', [questao.id]);
  assert.equal(rows[0].situacao, 'ATIVA');
  assert.equal(rows[0].enunciado, OBJETIVA.enunciado);
});

// ------------------------------------------------------------------ organizar (listar)

test('a listagem filtra por tipo, tema e texto do enunciado', async () => {
  const prof = await entrar(PROF.email);
  await criarQuestao(prof, OBJETIVA);
  await criarQuestao(prof, DISCURSIVA);
  await criarQuestao(prof, { ...OBJETIVA, enunciado: 'Quanto é 3 x 3?', tema: 'aritmética' });

  const discursivas = await prof.get('/api/questoes').query({ tipo: 'DISCURSIVA' });
  assert.deepEqual(discursivas.body.questoes.map((q) => q.tipo), ['DISCURSIVA']);

  // Tema sem diferenciar maiúsculas: "Aritmética" e "aritmética" são o mesmo.
  const aritmetica = await prof.get('/api/questoes').query({ tema: 'ARITMÉTICA' });
  assert.equal(aritmetica.body.total, 2);

  const busca = await prof.get('/api/questoes').query({ busca: '3 x 3' });
  assert.equal(busca.body.total, 1);
});

test('a listagem mostra só as ativas por padrão e aceita ver as inativas', async () => {
  const prof = await entrar(PROF.email);
  const q1 = await criarQuestao(prof);
  await criarQuestao(prof, DISCURSIVA);
  await prof.patch(`/api/questoes/${q1.id}/situacao`).send({ situacao: 'INATIVA' });

  assert.equal((await prof.get('/api/questoes')).body.total, 1);
  assert.equal((await prof.get('/api/questoes').query({ situacao: 'INATIVA' })).body.total, 1);
  assert.equal((await prof.get('/api/questoes').query({ situacao: 'TODAS' })).body.total, 2);
});

test('a lista de temas agrupa grafias iguais e é só do professor', async () => {
  const prof = await entrar(PROF.email);
  await criarQuestao(prof, OBJETIVA); // Aritmética
  await criarQuestao(prof, { ...OBJETIVA, tema: 'aritmética' });
  await criarQuestao(prof, DISCURSIVA); // Banco de Dados
  await criarQuestao(prof, { ...OBJETIVA, tema: null });

  const outro = await entrar(OUTRO_PROF.email);
  await criarQuestao(outro, { ...OBJETIVA, tema: 'Tema do outro' });

  const temas = (await prof.get('/api/questoes/temas')).body.temas;
  assert.equal(temas.length, 2);
  assert.ok(temas.some((t) => t.toLowerCase() === 'aritmética'));
  assert.ok(temas.includes('Banco de Dados'));
  assert.ok(!temas.includes('Tema do outro'));
});

test('a listagem pagina e informa o total', async () => {
  const prof = await entrar(PROF.email);
  for (let i = 0; i < 5; i += 1) await criarQuestao(prof, { ...OBJETIVA, enunciado: `Questão ${i}` });

  const pagina1 = await prof.get('/api/questoes').query({ tamanho: 2 });
  assert.equal(pagina1.body.questoes.length, 2);
  assert.equal(pagina1.body.total, 5);
  assert.equal(pagina1.body.paginas, 3);
});

// ---------------------------------------------------------------------------- edição

test('professor edita a questão, inclusive as alternativas', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  const resposta = await prof.put(`/api/questoes/${questao.id}`).send({
    ...OBJETIVA,
    enunciado: 'Quanto é 2 + 3?',
    alternativas: [
      { texto: '5', correta: true },
      { texto: '6', correta: false },
    ],
  });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.questao.enunciado, 'Quanto é 2 + 3?');
  assert.deepEqual(resposta.body.questao.alternativas.map((a) => [a.texto, a.correta]), [
    ['5', true],
    ['6', false],
  ]);
});

test('trocar objetiva por discursiva descarta as alternativas', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  const resposta = await prof.put(`/api/questoes/${questao.id}`).send(DISCURSIVA);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.questao.tipo, 'DISCURSIVA');
  assert.deepEqual(resposta.body.questao.alternativas, []);
});

test('edição inválida não altera nada', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  const resposta = await prof.put(`/api/questoes/${questao.id}`).send({ ...OBJETIVA, alternativas: [] });
  assert.equal(resposta.status, 400);

  const depois = await prof.get(`/api/questoes/${questao.id}`);
  assert.equal(depois.body.questao.alternativas.length, 3);
});

test('questão em avaliação ainda não iniciada pode ser editada (P-15a)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  await colocarEmAvaliacao(questao.id, { status: 'PUBLICADA' });

  const resposta = await prof.put(`/api/questoes/${questao.id}`).send({ ...OBJETIVA, enunciado: 'Ajustado' });
  assert.equal(resposta.status, 200);
});

// --------------------------------------------------------------------------- P-16

test('questão já respondida pode ser editada; a prova aplicada guarda a própria cópia (P-22)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  const avaliacaoId = await colocarEmAvaliacao(questao.id, { status: 'PUBLICADA', comTentativa: true });

  const detalhe = await prof.get(`/api/questoes/${questao.id}`);
  assert.equal(detalhe.body.questao.uso.respondida, true, 'a tela ainda sabe que a questão já foi aplicada');
  assert.equal(detalhe.body.questao.uso.podeEditar, true);

  const resposta = await prof.put(`/api/questoes/${questao.id}`).send({ ...OBJETIVA, enunciado: 'Enunciado corrigido' });
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));

  // O banco mudou...
  const { rows } = await query('SELECT enunciado FROM questao WHERE id = $1', [questao.id]);
  assert.equal(rows[0].enunciado, 'Enunciado corrigido');

  // ...e a prova que os estudantes fizeram continua com o texto original.
  const { rows: naProva } = await query(
    'SELECT enunciado FROM avaliacao_questao WHERE avaliacao_id = $1 AND questao_id = $2',
    [avaliacaoId, questao.id],
  );
  assert.equal(naProva[0].enunciado, OBJETIVA.enunciado);
});

test('questão já aplicada pode ser inativada quando nenhuma prova pendente depende dela (P-22)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  // Avaliação arquivada e já aplicada: a prova guarda a cópia, então o banco fica livre.
  await colocarEmAvaliacao(questao.id, { status: 'ARQUIVADA', comTentativa: true });

  const resposta = await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  assert.equal(resposta.body.questao.situacao, 'INATIVA');
});

test('questão já respondida pode ser duplicada, e a cópia é independente', async () => {
  const prof = await entrar(PROF.email);
  const original = await criarQuestao(prof);
  await colocarEmAvaliacao(original.id, { status: 'PUBLICADA', comTentativa: true });

  const duplicacao = await prof.post(`/api/questoes/${original.id}/duplicar`);
  assert.equal(duplicacao.status, 201);

  const copia = duplicacao.body.questao;
  assert.notEqual(copia.id, original.id);
  assert.equal(copia.enunciado, original.enunciado);
  assert.deepEqual(
    copia.alternativas.map((a) => [a.texto, a.correta]),
    original.alternativas.map((a) => [a.texto, a.correta]),
  );
  // A cópia nasce livre: sem vínculo com avaliações nem respostas.
  assert.equal(copia.uso.respondida, false);
  assert.equal(copia.uso.avaliacoesVinculadas, 0);
  assert.equal(copia.situacao, 'ATIVA');

  const edicao = await prof.put(`/api/questoes/${copia.id}`).send({ ...OBJETIVA, enunciado: 'Versão 2' });
  assert.equal(edicao.status, 200);

  // O original continua como estava.
  const { rows } = await query('SELECT enunciado FROM questao WHERE id = $1', [original.id]);
  assert.equal(rows[0].enunciado, OBJETIVA.enunciado);
});

test('a duplicação também funciona para discursivas', async () => {
  const prof = await entrar(PROF.email);
  const original = await criarQuestao(prof, DISCURSIVA);
  const copia = (await prof.post(`/api/questoes/${original.id}/duplicar`)).body.questao;

  assert.equal(copia.respostaEsperada, DISCURSIVA.respostaEsperada);
  assert.equal(copia.criteriosCorrecao, DISCURSIVA.criteriosCorrecao);
});

// ----------------------------------------------------------- excluir = inativar (UC05)

test('"excluir" inativa a questão, que continua no banco (Quadro 31)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  const resposta = await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.questao.situacao, 'INATIVA');

  const { rows } = await query('SELECT situacao FROM questao WHERE id = $1', [questao.id]);
  assert.equal(rows.length, 1, 'a questão não pode ser apagada fisicamente');
  const { rows: alts } = await query('SELECT count(*)::int AS total FROM alternativa WHERE questao_id = $1', [questao.id]);
  assert.equal(alts[0].total, 3, 'as alternativas continuam preservadas');
});

test('não existe rota de exclusão física', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);

  assert.equal((await prof.delete(`/api/questoes/${questao.id}`)).status, 404);
  const { rows } = await query('SELECT count(*)::int AS total FROM questao WHERE id = $1', [questao.id]);
  assert.equal(rows[0].total, 1);
});

test('questão em avaliação publicada não pode ser excluída (UC05 A1)', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  await colocarEmAvaliacao(questao.id, { status: 'PUBLICADA' });

  const detalhe = await prof.get(`/api/questoes/${questao.id}`);
  assert.equal(detalhe.body.questao.uso.emAvaliacaoPublicada, true);
  assert.equal(detalhe.body.questao.uso.podeInativar, false);

  const resposta = await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /avaliação publicada/i);

  const { rows } = await query('SELECT situacao FROM questao WHERE id = $1', [questao.id]);
  assert.equal(rows[0].situacao, 'ATIVA');
});

test('questão só em avaliação rascunho pode ser inativada', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  await colocarEmAvaliacao(questao.id, { status: 'RASCUNHO' });

  const resposta = await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(resposta.status, 200);
});

test('questão inativada pode ser reativada', async () => {
  const prof = await entrar(PROF.email);
  const questao = await criarQuestao(prof);
  await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'INATIVA' });

  const resposta = await prof.patch(`/api/questoes/${questao.id}/situacao`).send({ situacao: 'ATIVA' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.questao.situacao, 'ATIVA');
});

test('id inexistente ou inválido não quebra a API', async () => {
  const prof = await entrar(PROF.email);
  assert.equal((await prof.get('/api/questoes/999999')).status, 404);
  assert.equal((await prof.get('/api/questoes/abc')).status, 400);
});
