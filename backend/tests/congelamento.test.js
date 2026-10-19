// Congelamento da questão dentro da prova (migração 004, decisão P-22 de 24/09/2026).
//
// A regra que este arquivo protege: o **banco de questões** pode mudar a qualquer
// momento; a **prova já aplicada** não muda junto. Quando o primeiro estudante inicia a
// avaliação, ela guarda a própria cópia do enunciado, das alternativas e do gabarito.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import {
  criarUsuario,
  encerrarBanco,
  limparDados,
  prepararBanco,
  vincularTurmaComEstudantes,
} from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const PROF = { nome: 'Prof. A', email: 'prof.a@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ANA = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const BRUNO = { nome: 'Bruno', email: 'bruno@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(ANA);
  await criarUsuario(BRUNO);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Prova pública com uma objetiva (2 pontos) e uma discursiva (3 pontos), publicada.
async function prepararProva(prof) {
  const objetiva = (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA',
    enunciado: 'Capital de Goiás?',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Rio Verde', correta: false }, { texto: 'Goiânia', correta: true }],
  })).body.questao;
  const discursiva = (await prof.post('/api/questoes').send({
    tipo: 'DISCURSIVA',
    enunciado: 'Explique o Cerrado.',
    pontuacaoPadrao: 3,
    respostaEsperada: 'Bioma de savana.',
    criteriosCorrecao: 'Citar savana.',
  })).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova de Geografia',
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await vincularTurmaComEstudantes(avaliacao.id, [ANA.email, BRUNO.email]);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: objetiva.id }, { questaoId: discursiva.id }],
  });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, objetiva, discursiva };
}

const snapshot = async (avaliacaoId, questaoId) =>
  (await query('SELECT enunciado, tipo, congelada_em FROM avaliacao_questao WHERE avaliacao_id = $1 AND questao_id = $2', [
    avaliacaoId,
    questaoId,
  ])).rows[0];

// ------------------------------------------------------------- quando congela

test('a prova só congela quando o primeiro estudante a inicia', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);

  // Publicada e ainda não aplicada: continua acompanhando o banco.
  assert.equal((await snapshot(avaliacao.id, objetiva.id)).congelada_em, null);

  const ana = await entrar(ANA.email);
  assert.equal((await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`)).status, 200);

  const congelada = await snapshot(avaliacao.id, objetiva.id);
  assert.notEqual(congelada.congelada_em, null);
  assert.equal(congelada.enunciado, 'Capital de Goiás?');
  assert.equal(congelada.tipo, 'OBJETIVA');

  const { rows: alternativas } = await query(
    'SELECT texto, correta FROM avaliacao_alternativa WHERE avaliacao_id = $1 AND questao_id = $2 ORDER BY ordem',
    [avaliacao.id, objetiva.id],
  );
  assert.deepEqual(alternativas.map((a) => a.texto), ['Rio Verde', 'Goiânia']);
  assert.deepEqual(alternativas.map((a) => a.correta), [false, true]);
});

test('o segundo estudante não congela de novo', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);

  await (await entrar(ANA.email)).post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const primeira = await snapshot(avaliacao.id, objetiva.id);
  await (await entrar(BRUNO.email)).post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const segunda = await snapshot(avaliacao.id, objetiva.id);

  assert.deepEqual(primeira.congelada_em, segunda.congelada_em, 'o congelamento acontece uma única vez');
  const { rows } = await query('SELECT count(*)::int AS total FROM avaliacao_alternativa WHERE avaliacao_id = $1', [
    avaliacao.id,
  ]);
  assert.equal(rows[0].total, 2, 'as alternativas não são duplicadas');
});

// ---------------------------------------- o banco muda, a prova aplicada não

test('editar a questão no banco não altera a prova já aplicada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  // O professor reescreve a questão por inteiro, inclusive o gabarito.
  const edicao = await prof.put(`/api/questoes/${objetiva.id}`).send({
    tipo: 'OBJETIVA',
    enunciado: 'Capital de Minas Gerais?',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Belo Horizonte', correta: true }, { texto: 'Ouro Preto', correta: false }],
  });
  assert.equal(edicao.status, 200, JSON.stringify(edicao.body));

  // A prova da Ana continua exatamente como era.
  const prova = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  const questaoNaProva = prova.body.questoes.find((q) => q.questaoId === objetiva.id);
  assert.equal(questaoNaProva.enunciado, 'Capital de Goiás?');
  assert.deepEqual(questaoNaProva.alternativas.map((a) => a.texto), ['Rio Verde', 'Goiânia']);

  // E o banco de questões, esse sim, mudou.
  const noBanco = (await prof.get(`/api/questoes/${objetiva.id}`)).body.questao;
  assert.equal(noBanco.enunciado, 'Capital de Minas Gerais?');
});

test('a correção usa o gabarito congelado, não o do banco', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);

  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alternativas = inicio.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas;
  const goiania = alternativas.find((a) => a.texto === 'Goiânia');

  // Depois de a prova começar, o professor troca a resposta certa no banco.
  await prof.put(`/api/questoes/${objetiva.id}`).send({
    tipo: 'OBJETIVA',
    enunciado: 'Capital de Goiás?',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Rio Verde', correta: true }, { texto: 'Goiânia', correta: false }],
  });

  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: goiania.id }, { questaoId: discursiva.id, texto: 'Savana.' }],
  });

  // Ana acertou pelo gabarito que viu: 2 pontos, e não zero.
  const { rows } = await query(
    `SELECT r.correta, r.nota_final FROM resposta r JOIN tentativa t ON t.id = r.tentativa_id
      WHERE t.avaliacao_id = $1 AND r.questao_id = $2`,
    [avaliacao.id, objetiva.id],
  );
  assert.equal(rows[0].correta, true);
  assert.equal(Number(rows[0].nota_final), 2);
});

test('inativar a questão no banco não afeta a prova já aplicada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const inativacao = await prof.patch(`/api/questoes/${objetiva.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(inativacao.status, 200, JSON.stringify(inativacao.body));

  const prova = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  assert.equal(prova.body.questoes.length, 2, 'a prova continua completa');
});

test('UC05 A1 continua: questão de prova publicada e ainda não aplicada não é inativada', async () => {
  const prof = await entrar(PROF.email);
  const { objetiva } = await prepararProva(prof);

  const resposta = await prof.patch(`/api/questoes/${objetiva.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /não pode ser excluída/i);
});

// -------------------------------------------------------- o professor enxerga a cópia

test('o professor vê na prova o texto congelado, e no banco o texto novo', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);
  await (await entrar(ANA.email)).post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  await prof.put(`/api/questoes/${objetiva.id}`).send({
    tipo: 'OBJETIVA',
    enunciado: 'Enunciado novo, só no banco',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'A', correta: true }, { texto: 'B', correta: false }],
  });

  const naProva = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.questoes.find(
    (q) => q.questaoId === objetiva.id,
  );
  assert.equal(naProva.enunciado, 'Capital de Goiás?');

  const noBanco = (await prof.get('/api/questoes')).body.questoes.find((q) => q.id === objetiva.id);
  assert.equal(noBanco.enunciado, 'Enunciado novo, só no banco');
  assert.equal(noBanco.uso.podeEditar, true, 'o banco nunca trava a edição (P-22)');
});

test('a tela de correção mostra a questão como o estudante a viu', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const goiania = inicio.body.questoes
    .find((q) => q.questaoId === objetiva.id)
    .alternativas.find((a) => a.texto === 'Goiânia');
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: goiania.id }, { questaoId: discursiva.id, texto: 'Savana.' }],
  });

  await prof.put(`/api/questoes/${objetiva.id}`).send({
    tipo: 'OBJETIVA',
    enunciado: 'Outra pergunta',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'X', correta: true }, { texto: 'Y', correta: false }],
  });

  const tentativas = (await prof.get(`/api/correcao/${avaliacao.id}`)).body.tentativas;
  const detalhe = (await prof.get(`/api/correcao/${avaliacao.id}/tentativas/${tentativas[0].id}`)).body;
  const questao = detalhe.questoes.find((q) => q.questaoId === objetiva.id);

  assert.equal(questao.enunciado, 'Capital de Goiás?');
  assert.deepEqual(questao.alternativas.map((a) => a.texto), ['Rio Verde', 'Goiânia']);
  assert.equal(questao.alternativaMarcada, goiania.id, 'a alternativa marcada é a da prova');
  assert.equal(questao.correta, true);
});
