// A turma vista pelo estudante: dados da turma e as avaliações vinculadas a ela
// (RF06, RF07, RF08). Somente leitura — nenhuma regra nova de negócio.
//
// O que precisa ficar garantido aqui: quem não tem vínculo não enxerga a turma; quem
// está pendente vê a turma mas não as provas; prova de outra turma não vaza; e a nota
// continua presa à liberação do professor (P-07).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { criarUsuario, encerrarBanco, limparDados, prepararBanco } from './ajuda/banco.js';
import { query } from '../src/db/pool.js';

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

async function criarQuestao(prof) {
  return (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA',
    enunciado: 'Capital de Goiás?',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Rio Verde', correta: false }, { texto: 'Goiânia', correta: true }],
  })).body.questao;
}

// Publica uma avaliação vinculada às turmas indicadas.
async function publicar(prof, questao, titulo, turmaIds, { inicio = -1, fim = 24 } = {}) {
  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo,
    duracaoMinutos: 60,
    dataInicio: daqui(inicio),
    dataFim: daqui(fim),
  })).body.avaliacao;
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: questao.id }] });
  await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return avaliacao;
}

async function cenario() {
  const prof = await entrar(PROF.email);
  const turma = (await prof.post('/api/turmas').send({ nome: 'Geografia — Manhã', descricao: 'Turma da manhã' })).body.turma;
  const outraTurma = (await prof.post('/api/turmas').send({ nome: 'História — Tarde' })).body.turma;
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  const questao = await criarQuestao(prof);
  return { prof, ana, turma, outraTurma, questao };
}

// ------------------------------------------------------------------------- acesso

test('somente o estudante vinculado abre a turma; os demais recebem 404', async () => {
  const { prof, ana, turma } = await cenario();
  const bruno = await entrar(BRUNO.email);

  assert.equal((await request(app).get(`/api/estudante/turmas/${turma.id}`)).status, 401);
  assert.equal((await ana.get(`/api/estudante/turmas/${turma.id}`)).status, 200);
  // Bruno não tem vínculo: a resposta não pode nem revelar que a turma existe.
  assert.equal((await bruno.get(`/api/estudante/turmas/${turma.id}`)).status, 404);
  // A rota é do estudante; o professor usa a dele.
  assert.equal((await prof.get(`/api/estudante/turmas/${turma.id}`)).status, 403);
  assert.equal((await ana.get('/api/estudante/turmas/9999')).status, 404);
});

// Os colegas passaram a aparecer em 16/10/2026, por decisão do autor: a turma do
// estudante mostra quem está nela, como a do professor. O que NÃO mudou é o resto — o
// código de acesso continua sendo do professor (quem o tem entra na turma), e o e-mail de
// cada colega continua fora. A regra virou "nome sim, contato e código não".
test('o estudante vê os colegas pelo nome, mas nunca o código de acesso nem o e-mail deles', async () => {
  const { ana, turma } = await cenario();
  const bruno = await entrar(BRUNO.email);
  await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const resposta = (await ana.get(`/api/estudante/turmas/${turma.id}`)).body;
  const corpo = JSON.stringify(resposta);

  assert.ok(
    resposta.colegas.some((c) => /bruno/i.test(c.nome)),
    'o colega aparece na lista de participantes',
  );
  assert.doesNotMatch(corpo, new RegExp(turma.codigoAcesso), 'o código de acesso nunca vai para o estudante');
  assert.doesNotMatch(corpo, new RegExp(BRUNO.email, 'i'), 'o e-mail do colega também não');
});

// -------------------------------------------------------------------- avaliações

test('a turma lista as avaliações vinculadas a ela, e só elas', async () => {
  const { prof, ana, turma, outraTurma, questao } = await cenario();
  await publicar(prof, questao, 'Prova de Geografia', [turma.id]);
  await publicar(prof, questao, 'Prova de História', [outraTurma.id]);

  const r = await ana.get(`/api/estudante/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.nome, 'Geografia — Manhã');
  assert.equal(r.body.turma.professor, PROF.nome);
  assert.deepEqual(r.body.avaliacoes.map((a) => a.titulo), ['Prova de Geografia']);
  assert.equal(r.body.avaliacoes[0].situacao, 'DISPONIVEL');
  assert.equal(r.body.avaliacoes[0].podeIniciar, true);
});

test('avaliação em rascunho não aparece para o estudante', async () => {
  const { prof, ana, turma, questao } = await cenario();
  const rascunho = (await prof.post('/api/avaliacoes').send({
    titulo: 'Ainda em rascunho',
    duracaoMinutos: 30,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await prof.put(`/api/avaliacoes/${rascunho.id}/questoes`).send({ questoes: [{ questaoId: questao.id }] });
  await prof.post(`/api/avaliacoes/${rascunho.id}/turmas`).send({ turmaIds: [turma.id] });

  const r = await ana.get(`/api/estudante/turmas/${turma.id}`);
  assert.deepEqual(r.body.avaliacoes, []);
});

test('a situação distingue o que está aberto, agendado, encerrado e entregue', async () => {
  const { prof, ana, turma, questao } = await cenario();
  const aberta = await publicar(prof, questao, 'Aberta agora', [turma.id]);
  await publicar(prof, questao, 'Começa depois', [turma.id], { inicio: 48, fim: 72 });
  const entregue = await publicar(prof, questao, 'Já entregue', [turma.id]);

  await ana.post(`/api/estudante/avaliacoes/${entregue.id}/iniciar`);
  await ana.post(`/api/estudante/avaliacoes/${entregue.id}/finalizar`).send({ respostas: [] });

  const porTitulo = Object.fromEntries(
    (await ana.get(`/api/estudante/turmas/${turma.id}`)).body.avaliacoes.map((a) => [a.titulo, a]),
  );
  assert.equal(porTitulo['Aberta agora'].situacao, 'DISPONIVEL');
  assert.equal(porTitulo['Começa depois'].situacao, 'AGENDADA');
  assert.equal(porTitulo['Começa depois'].podeIniciar, false);
  assert.equal(porTitulo['Já entregue'].situacao, 'FINALIZADA');
  assert.equal(porTitulo['Já entregue'].podeIniciar, false);
  assert.equal(aberta.status, 'RASCUNHO', 'o objeto devolvido na criação é anterior à publicação');
});

test('P-07: a nota só aparece na turma depois de o professor liberar', async () => {
  const { prof, ana, turma, questao } = await cenario();
  const avaliacao = await publicar(prof, questao, 'Prova de Geografia', [turma.id]);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alternativas = inicio.body.questoes[0].alternativas;
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: questao.id, alternativaId: alternativas.find((a) => a.texto === 'Goiânia').id }],
  });

  const antes = (await ana.get(`/api/estudante/turmas/${turma.id}`)).body.avaliacoes[0];
  assert.equal(antes.resultado, null, 'sem liberação, nem a API envia a nota');

  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);
  const depois = (await ana.get(`/api/estudante/turmas/${turma.id}`)).body.avaliacoes[0];
  assert.equal(depois.resultado.nota, 2);
  assert.equal(depois.resultado.pontuacaoMaxima, 2);
});

test('o gabarito nunca acompanha a listagem da turma', async () => {
  const { prof, ana, turma, questao } = await cenario();
  await publicar(prof, questao, 'Prova de Geografia', [turma.id]);

  const corpo = JSON.stringify((await ana.get(`/api/estudante/turmas/${turma.id}`)).body);
  assert.doesNotMatch(corpo, /Goiânia/);
  assert.doesNotMatch(corpo, /alternativa/i);
});

// ------------------------------------------------------------------- vínculo pendente

test('quem está aguardando aprovação vê a turma, mas não as provas', async () => {
  const prof = await entrar(PROF.email);
  const turma = (await prof.post('/api/turmas').send({ nome: 'Com aprovação', requerAprovacao: true })).body.turma;
  const questao = await criarQuestao(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await publicar(prof, questao, 'Prova de Geografia', [turma.id]);

  const pendente = await ana.get(`/api/estudante/turmas/${turma.id}`);
  assert.equal(pendente.status, 200);
  assert.equal(pendente.body.turma.situacao, 'PENDENTE');
  assert.deepEqual(pendente.body.avaliacoes, [], 'provas só depois da aprovação');

  // Aprovado, passa a ver.
  await prof.post(`/api/turmas/${turma.id}/solicitacoes/${(await ana.get('/api/auth/eu')).body.usuario.id}/aprovar`);
  const aprovado = await ana.get(`/api/estudante/turmas/${turma.id}`);
  assert.equal(aprovado.body.turma.situacao, 'APROVADA');
  assert.deepEqual(aprovado.body.avaliacoes.map((a) => a.titulo), ['Prova de Geografia']);
});

test('turma inativada continua acessível, marcada como encerrada', async () => {
  const { prof, ana, turma, questao } = await cenario();
  await publicar(prof, questao, 'Prova de Geografia', [turma.id]);
  await prof.patch(`/api/turmas/${turma.id}/situacao`).send({ situacao: 'INATIVA' });

  const r = await ana.get(`/api/estudante/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.turmaAtiva, false);
  // DT46: inativar a turma não retira o que já estava vinculado.
  assert.deepEqual(r.body.avaliacoes.map((a) => a.titulo), ['Prova de Geografia']);
});

// ------------------------------------------------- P-24: cancelar a inscrição

test('o estudante cancela a própria inscrição e a turma sai da lista dele', async () => {
  const { ana, turma } = await cenario();
  const r = await ana.post(`/api/estudante/turmas/${turma.id}/sair`);
  assert.equal(r.status, 200);
  assert.match(r.body.mensagem, /saiu da turma/i);

  const lista = await ana.get('/api/estudante/turmas');
  assert.equal(lista.body.turmas.length, 0, 'a turma some da lista de quem saiu');
  assert.equal((await ana.get(`/api/estudante/turmas/${turma.id}`)).status, 404);
});

test('sair é exclusão lógica: o vínculo continua no banco, com a data', async () => {
  const { ana, turma } = await cenario();
  await ana.post(`/api/estudante/turmas/${turma.id}/sair`);

  const { rows } = await query('SELECT situacao, saiu_em FROM turma_estudante WHERE turma_id = $1', [turma.id]);
  assert.equal(rows.length, 1, 'a linha do vínculo não é apagada');
  assert.equal(rows[0].situacao, 'SAIU');
  assert.ok(rows[0].saiu_em, 'a saída fica datada');
});

test('quem saiu deixa de contar como estudante da turma para o professor', async () => {
  const { prof, ana, turma } = await cenario();
  assert.equal((await prof.get(`/api/turmas/${turma.id}`)).body.turma.estudantes.length, 1);
  await ana.post(`/api/estudante/turmas/${turma.id}/sair`);
  const depois = await prof.get(`/api/turmas/${turma.id}`);
  assert.equal(depois.body.turma.estudantes.length, 0);
  assert.equal(depois.body.turma.pendentes.length, 0, 'e também não vira solicitação pendente');
});

test('a prova que ele já fez continua registrada com o professor', async () => {
  const { prof, ana, turma, questao } = await cenario();
  const avaliacao = await publicar(prof, questao, 'Prova feita antes de sair', [turma.id]);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const certa = inicio.body.questoes[0].alternativas.find((a) => a.texto === 'Goiânia');
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`)
    .send({ respostas: [{ questaoId: inicio.body.questoes[0].questaoId, alternativaId: certa.id }] });

  await ana.post(`/api/estudante/turmas/${turma.id}/sair`);

  const painel = await prof.get(`/api/dashboard/avaliacoes/${avaliacao.id}?turmaId=${turma.id}`);
  assert.equal(painel.body.participacao.corrigidas, 1, 'a prova continua no recorte da turma');
  assert.equal(painel.body.resumo.media, 2);
});

test('não dá para sair com prova em andamento na turma', async () => {
  const { prof, ana, turma, questao } = await cenario();
  const avaliacao = await publicar(prof, questao, 'Prova em andamento', [turma.id]);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await ana.post(`/api/estudante/turmas/${turma.id}/sair`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /em andamento/i);
  assert.equal((await ana.get('/api/estudante/turmas')).body.turmas.length, 1, 'continua na turma');
});

test('depois de sair, o estudante pode voltar com o código', async () => {
  const { ana, turma } = await cenario();
  await ana.post(`/api/estudante/turmas/${turma.id}/sair`);

  const volta = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(volta.status, 201);
  assert.equal(volta.body.situacao, 'APROVADA');
  assert.equal((await ana.get('/api/estudante/turmas')).body.turmas.length, 1);

  const { rows } = await query('SELECT count(*)::int AS n FROM turma_estudante WHERE turma_id = $1', [turma.id]);
  assert.equal(rows[0].n, 1, 'voltar atualiza o vínculo, não cria outro');
});

test('cancelar solicitação pendente também é sair', async () => {
  const prof = await entrar(PROF.email);
  const turma = (await prof.post('/api/turmas').send({ nome: 'Com aprovação', requerAprovacao: true })).body.turma;
  const bruno = await entrar(BRUNO.email);
  await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal((await prof.get(`/api/turmas/${turma.id}`)).body.turma.pendentes.length, 1);

  const r = await bruno.post(`/api/estudante/turmas/${turma.id}/sair`);
  assert.equal(r.status, 200);
  assert.equal(r.body.pendente, true);
  assert.equal((await prof.get(`/api/turmas/${turma.id}`)).body.turma.pendentes.length, 0);
});

test('turma alheia, inexistente ou já abandonada não deixam sair', async () => {
  const { ana, turma } = await cenario();
  const bruno = await entrar(BRUNO.email);
  assert.equal((await bruno.post(`/api/estudante/turmas/${turma.id}/sair`)).status, 404, 'sem vínculo: 404');
  assert.equal((await ana.post('/api/estudante/turmas/9999/sair')).status, 404);

  assert.equal((await ana.post(`/api/estudante/turmas/${turma.id}/sair`)).status, 200);
  assert.equal((await ana.post(`/api/estudante/turmas/${turma.id}/sair`)).status, 409, 'sair de novo: 409');
});

test('só o estudante sai por esta rota', async () => {
  const { prof, turma } = await cenario();
  assert.equal((await prof.post(`/api/estudante/turmas/${turma.id}/sair`)).status, 403);
  assert.equal((await request(app).post(`/api/estudante/turmas/${turma.id}/sair`)).status, 401);
});
