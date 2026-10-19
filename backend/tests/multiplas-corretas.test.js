// P-26 — objetiva com mais de uma alternativa correta, e a nota parcial dela.
//
// A conta é `máximo(0, (certas − erradas) / total de corretas) × pontuação`. Os testes
// abaixo existem sobretudo pelos extremos: marcar tudo precisa dar **zero**, porque é o
// que impede resolver a questão sem saber a matéria; e errar muito não pode descontar da
// questão seguinte, por isso o piso.
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
const ALUNO = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(ALUNO);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Questão de 4 alternativas, com `corretas` marcando quais são verdadeiras.
function corpoDaQuestao({ multiplasCorretas, corretas }) {
  return {
    tipo: 'OBJETIVA',
    enunciado: 'Quais afirmativas sobre o modelo relacional estão corretas?',
    pontuacaoPadrao: 4,
    multiplasCorretas,
    alternativas: ['Afirmativa I', 'Afirmativa II', 'Afirmativa III', 'Afirmativa IV'].map((texto, i) => ({
      texto,
      correta: corretas.includes(i),
    })),
  };
}

// Monta prova publicada com uma questão de múltipla escolha valendo 4 pontos.
async function prepararProva(prof, { corretas = [0, 1] } = {}) {
  const questao = (await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: true, corretas })))
    .body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova com múltipla escolha',
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await vincularTurmaComEstudantes(avaliacao.id, [ALUNO.email]);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: questao.id }] });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, questao };
}

// O estudante marca as alternativas das posições indicadas e entrega.
async function responder({ avaliacao, questao }, posicoes) {
  const aluno = await entrar(ALUNO.email);
  const inicio = await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(inicio.status, 200, JSON.stringify(inicio.body));
  const daProva = inicio.body.questoes.find((q) => q.questaoId === questao.id);
  const ids = posicoes.map((i) => daProva.alternativas[i].id);

  await aluno
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: questao.id, alternativaIds: ids }] });
  const entrega = await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas: [] });
  assert.equal(entrega.status, 200, JSON.stringify(entrega.body));
  return { aluno, daProva };
}

async function notaDaProva(prof, avaliacaoId) {
  const painel = await prof.get(`/api/correcao/${avaliacaoId}`);
  return painel.body.tentativas[0];
}

// ------------------------------------------------------------------------ cadastro

test('a questão declara que aceita mais de uma correta, e o padrão continua sendo uma só', async () => {
  const prof = await entrar(PROF.email);

  const unica = await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: false, corretas: [0] }));
  assert.equal(unica.status, 201);
  assert.equal(unica.body.questao.multiplasCorretas, false, 'o padrão é resposta única');

  const varias = await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: true, corretas: [0, 2] }));
  assert.equal(varias.status, 201, JSON.stringify(varias.body));
  assert.equal(varias.body.questao.multiplasCorretas, true);
  assert.equal(varias.body.questao.alternativas.filter((a) => a.correta).length, 2);
});

test('questão de resposta única recusa duas corretas, e a mensagem diz o que fazer', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: false, corretas: [0, 1] }));
  assert.equal(r.status, 400);
  assert.match(r.body.campos.alternativas, /Mais de uma alternativa correta/);
});

test('questão de múltipla escolha ainda exige pelo menos uma correta', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: true, corretas: [] }));
  assert.equal(r.status, 400);
  assert.match(r.body.campos.alternativas, /pelo menos uma/);
});

test('discursiva não pode ser marcada como de múltipla escolha', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/questoes').send({
    tipo: 'DISCURSIVA',
    enunciado: 'Explique o modelo relacional.',
    pontuacaoPadrao: 3,
    multiplasCorretas: true,
  });
  assert.equal(r.status, 400);
  assert.ok(r.body.campos.multiplasCorretas, JSON.stringify(r.body));
});

test('duplicar preserva o tipo de resposta', async () => {
  const prof = await entrar(PROF.email);
  const original = (await prof.post('/api/questoes').send(corpoDaQuestao({ multiplasCorretas: true, corretas: [1, 3] })))
    .body.questao;
  const copia = await prof.post(`/api/questoes/${original.id}/duplicar`);
  assert.equal(copia.status, 201);
  assert.equal(copia.body.questao.multiplasCorretas, true);
  assert.equal(copia.body.questao.alternativas.filter((a) => a.correta).length, 2);
});

// --------------------------------------------------------------- a conta da nota

test('acertar as duas corretas, sem marcar errada, vale a nota cheia', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, [0, 1]);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 4, '(2−0)/2 × 4');
});

test('marcar uma correta de duas vale metade', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, [0]);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 2, '(1−0)/2 × 4');
});

test('acertar as duas e marcar uma errada volta para metade', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, [0, 1, 2]);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 2, '(2−1)/2 × 4');
});

test('marcar TODAS as alternativas vale zero — é a razão de o erro descontar', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, [0, 1, 2, 3]);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 0, '(2−2)/2 × 4');
});

test('errar mais do que acertar para em zero, e não em nota negativa', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0] });
  await responder(prova, [1, 2, 3]);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 0, '(0−3)/1 teria dado −12');
});

test('não marcar nada vale zero, como qualquer objetiva em branco (P-12)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, []);

  const t = await notaDaProva(prof, prova.avaliacao.id);
  assert.equal(Number(t.pontuacaoObjetiva), 0);
});

test('a nota parcial não conta como acerto: só o integral marca "correta"', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { corretas: [0, 1] });
  await responder(prova, [0]);

  const { rows } = await query('SELECT correta, nota_final FROM resposta');
  assert.equal(rows[0].correta, false, 'meio acerto não é acerto');
  assert.equal(Number(rows[0].nota_final), 2);
});

// ------------------------------------------------------------- o que a prova mostra

test('a prova diz à tela que a questão aceita várias marcações, sem entregar o gabarito', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questao } = await prepararProva(prof, { corretas: [0, 1] });

  const aluno = await entrar(ALUNO.email);
  const inicio = await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const daProva = inicio.body.questoes.find((q) => q.questaoId === questao.id);

  assert.equal(daProva.marcarVarias, true);

  // O nome do campo também importa. "multiplasCorretas" contaria quantas são certas e
  // faria o corpo da prova carregar a palavra que o teste de vazamento procura (DT13).
  // A verificação é sobre os **nomes** dos campos: o enunciado pode perfeitamente
  // perguntar "quais afirmativas estão corretas?", e isso não é vazamento nenhum.
  const nomes = (objeto) =>
    Object.entries(objeto).flatMap(([chave, valor]) =>
      valor && typeof valor === 'object'
        ? [chave, ...(Array.isArray(valor) ? valor.flatMap(nomes) : nomes(valor))]
        : [chave],
    );
  assert.ok(
    !nomes(daProva).some((chave) => /correta/i.test(chave)),
    nomes(daProva).join(', '),
  );
  // RNF17 / DT13: saber que há mais de uma correta não pode dizer quais são.
  assert.ok(daProva.alternativas.every((a) => !('correta' in a)), JSON.stringify(daProva.alternativas[0]));
});

test('desmarcar é resposta legítima enquanto o estudante não sai da prova', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questao } = await prepararProva(prof, { corretas: [0, 1] });

  const aluno = await entrar(ALUNO.email);
  const inicio = await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alts = inicio.body.questoes.find((q) => q.questaoId === questao.id).alternativas;

  await aluno.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({
    respostas: [{ questaoId: questao.id, alternativaIds: [alts[0].id, alts[2].id] }],
  });

  // Desmarcar tudo apaga o que havia: é resposta, não ausência de resposta.
  await aluno
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: questao.id, alternativaIds: [] }] });
  const aberta = await aluno.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  const salva = aberta.body.respostas.find((r) => r.questaoId === questao.id);
  assert.deepEqual(salva.alternativaIds, []);
});

// Este teste afirmava, até 18/10/2026, que desmarcar continuava valendo DEPOIS de
// recarregar a prova. A trava da migração 017 inverteu isso por decisão do autor: o que
// foi respondido antes de sair fica como está, e recarregar conta como sair.
//
// O que a P-26 garante segue intacto — marcar várias, desmarcar, a nota parcial. O que
// mudou é até quando isso pode ser feito.
test('as marcações sobrevivem ao recarregar, mas não podem mais ser alteradas', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questao } = await prepararProva(prof, { corretas: [0, 1] });

  const aluno = await entrar(ALUNO.email);
  const inicio = await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alts = inicio.body.questoes.find((q) => q.questaoId === questao.id).alternativas;

  await aluno.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({
    respostas: [{ questaoId: questao.id, alternativaIds: [alts[0].id, alts[2].id] }],
  });

  // Recarregar a prova: as marcações continuam lá, agora fechadas.
  const aberta = await aluno.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  const salva = aberta.body.respostas.find((r) => r.questaoId === questao.id);
  assert.deepEqual([...salva.alternativaIds].sort((a, b) => a - b), [alts[0].id, alts[2].id].sort((a, b) => a - b));
  assert.equal(salva.travada, true);

  const tentarDesmarcar = await aluno
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: questao.id, alternativaIds: [] }] });
  assert.equal(tentarDesmarcar.status, 409);
});

test('alternativa de outra questão é recusada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questao } = await prepararProva(prof, { corretas: [0, 1] });

  const aluno = await entrar(ALUNO.email);
  await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const r = await aluno
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: questao.id, alternativaIds: [999999] }] });
  assert.equal(r.status, 400);
});

// ------------------------------------------------------------------- congelamento

test('o tipo de resposta congela junto com a prova (P-22)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questao } = await prepararProva(prof, { corretas: [0, 1] });

  // O primeiro início congela a prova.
  const aluno = await entrar(ALUNO.email);
  await aluno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const { rows } = await query(
    'SELECT multiplas_corretas FROM avaliacao_questao WHERE avaliacao_id = $1 AND questao_id = $2',
    [avaliacao.id, questao.id],
  );
  assert.equal(rows[0].multiplas_corretas, true);

  // Mudar a questão no banco depois não altera a prova aplicada.
  await prof.put(`/api/questoes/${questao.id}`).send(corpoDaQuestao({ multiplasCorretas: false, corretas: [0] }));
  const depois = await query(
    'SELECT multiplas_corretas FROM avaliacao_questao WHERE avaliacao_id = $1 AND questao_id = $2',
    [avaliacao.id, questao.id],
  );
  assert.equal(depois.rows[0].multiplas_corretas, true, 'a prova guarda o que o estudante viu');
});
