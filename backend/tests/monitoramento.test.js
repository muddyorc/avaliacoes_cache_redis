// RF10 / UC10 — monitoramento da integridade da avaliação.
//
// O que precisa ficar garantido aqui: o evento só é aceito de quem está fazendo a prova;
// o limite de ocorrências encerra a tentativa **preservando as respostas**; o
// monitoramento desligado não grava nada; e o relatório é do professor dono, nunca do
// estudante.
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
const OUTRO_PROF = { nome: 'Prof. B', email: 'prof.b@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ANA = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const BRUNO = { nome: 'Bruno', email: 'bruno@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  for (const u of [PROF, OUTRO_PROF, ANA, BRUNO]) await criarUsuario(u);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Prova pública com duas objetivas; `limiteOcorrencias` null = registra sem bloquear.
async function prepararProva(prof, { limiteOcorrencias = null, monitoramentoAtivo = true } = {}) {
  const criar = (enunciado) =>
    prof.post('/api/questoes').send({
      tipo: 'OBJETIVA',
      enunciado,
      pontuacaoPadrao: 2,
      alternativas: [{ texto: 'Certa', correta: true }, { texto: 'Errada', correta: false }],
    });
  const q1 = (await criar('Capital de Goiás?')).body.questao;
  const q2 = (await criar('Maior bioma do Centro-Oeste?')).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova monitorada',
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
    monitoramentoAtivo,
    limiteOcorrencias,
  })).body.avaliacao;
  await vincularTurmaComEstudantes(avaliacao.id, [ANA.email, BRUNO.email]);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: q1.id }, { questaoId: q2.id }],
  });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, q1, q2 };
}

const relatar = (agente, avaliacaoId, eventos) =>
  agente.post(`/api/estudante/avaliacoes/${avaliacaoId}/eventos`).send({ eventos });

const perdaDeFoco = (quantas) => Array.from({ length: quantas }, () => ({ tipo: 'PERDA_FOCO' }));

// ------------------------------------------------------------------ registro

test('os eventos da prova em andamento são registrados', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await relatar(ana, avaliacao.id, [
    { tipo: 'TROCA_ABA' },
    { tipo: 'ATALHO', detalhe: 'Ctrl+C' },
  ]);

  assert.equal(r.status, 200);
  assert.equal(r.body.monitorada, true);
  assert.equal(r.body.ocorrencias, 2);
  assert.equal(r.body.bloqueada, false);

  const { rows } = await query('SELECT tipo, detalhe FROM evento_monitoramento ORDER BY id');
  assert.deepEqual(rows.map((e) => e.tipo), ['TROCA_ABA', 'ATALHO']);
  assert.equal(rows[1].detalhe, 'Ctrl+C', 'o detalhe do atalho fica registrado');
});

test('a hora do evento é do servidor, não do navegador', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  // O cliente tenta enviar uma data — ela simplesmente não é aceita pelo esquema.
  await relatar(ana, avaliacao.id, [{ tipo: 'PERDA_FOCO', dataHora: '2020-01-01T00:00:00Z' }]);

  const { rows } = await query('SELECT data_hora FROM evento_monitoramento');
  assert.ok(new Date(rows[0].data_hora).getFullYear() > 2020, 'a hora gravada é a do servidor');
});

test('tipo de evento fora da lista é recusado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await relatar(ana, avaliacao.id, [{ tipo: 'CAMERA_DESLIGADA' }]);
  assert.equal(r.status, 400);
  assert.equal((await query('SELECT count(*)::int AS n FROM evento_monitoramento')).rows[0].n, 0);
});

test('o navegador sem recurso de monitoramento também é registrado (UC10 A5)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: 2 });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await relatar(ana, avaliacao.id, [
    { tipo: 'RECURSO_INDISPONIVEL', detalhe: 'visibilitychange' },
    { tipo: 'RECURSO_INDISPONIVEL', detalhe: 'blur' },
    { tipo: 'RECURSO_INDISPONIVEL', detalhe: 'teclado' },
  ]);

  // Registra, mas não conta para o limite: o estudante não escolhe o navegador da escola.
  assert.equal(r.body.ocorrencias, 0);
  assert.equal(r.body.bloqueada, false);
  assert.equal((await query('SELECT count(*)::int AS n FROM evento_monitoramento')).rows[0].n, 3);
});

test('sem limite definido, o monitoramento só registra (P-06)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: null });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await relatar(ana, avaliacao.id, perdaDeFoco(30));
  assert.equal(r.body.ocorrencias, 30);
  assert.equal(r.body.limite, null);
  assert.equal(r.body.bloqueada, false);

  const { rows } = await query("SELECT status FROM tentativa WHERE avaliacao_id = $1", [avaliacao.id]);
  assert.equal(rows[0].status, 'EM_ANDAMENTO', 'a prova continua');
});

test('monitoramento desligado não grava evento nenhum', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { monitoramentoAtivo: false });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await relatar(ana, avaliacao.id, perdaDeFoco(5));
  assert.equal(r.status, 200);
  assert.equal(r.body.monitorada, false);
  assert.equal((await query('SELECT count(*)::int AS n FROM evento_monitoramento')).rows[0].n, 0);
});

// ------------------------------------------------------------------ bloqueio

test('atingir o limite encerra a tentativa e preserva as respostas (UC10 A4)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, q1 } = await prepararProva(prof, { limiteOcorrencias: 3 });
  const ana = await entrar(ANA.email);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  // O estudante responde antes de perder o foco três vezes.
  const questao = inicio.body.questoes.find((q) => q.questaoId === q1.id);
  const certa = questao.alternativas.find((a) => a.texto === 'Certa');
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: q1.id, alternativaId: certa.id }] });

  const r = await relatar(ana, avaliacao.id, perdaDeFoco(3));
  assert.equal(r.body.bloqueada, true);
  assert.equal(r.body.encerradaAgora, true);
  assert.match(r.body.motivo, /limite de ocorrências/i);

  const { rows } = await query(
    'SELECT status, motivo_bloqueio, finalizada_em, pontuacao_total FROM tentativa WHERE avaliacao_id = $1',
    [avaliacao.id],
  );
  assert.equal(rows[0].status, 'BLOQUEADA');
  assert.ok(rows[0].motivo_bloqueio, 'o motivo fica registrado para o professor (P-06)');
  assert.ok(rows[0].finalizada_em);
  // A resposta dada antes do bloqueio continua lá e foi corrigida (DT61).
  const { rows: respostas } = await query('SELECT correta FROM resposta');
  assert.equal(respostas.length, 1, 'nada do que o estudante respondeu se perde');
  assert.equal(respostas[0].correta, true);
  assert.equal(Number(rows[0].pontuacao_total), 2, 'as objetivas são corrigidas no bloqueio');
});

test('o evento que causou o bloqueio fica marcado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: 2 });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  await relatar(ana, avaliacao.id, [{ tipo: 'PERDA_FOCO' }, { tipo: 'TROCA_ABA' }]);

  const { rows } = await query(
    'SELECT tipo, bloqueou_tentativa FROM evento_monitoramento ORDER BY data_hora, id',
  );
  assert.equal(rows[0].bloqueou_tentativa, false);
  assert.equal(rows[1].bloqueou_tentativa, true, 'o último evento é o que encerrou');
});

test('depois de bloqueada, a prova não aceita resposta nem novo evento', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, q1 } = await prepararProva(prof, { limiteOcorrencias: 1 });
  const ana = await entrar(ANA.email);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const certa = inicio.body.questoes[0].alternativas.find((a) => a.texto === 'Certa');

  await relatar(ana, avaliacao.id, [{ tipo: 'TROCA_ABA' }]);

  const salvar = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: q1.id, alternativaId: certa.id }] });
  assert.equal(salvar.status, 409, 'a prova encerrada não recebe mais respostas');

  // Eventos que cheguem depois não são gravados, e a resposta diz o estado atual.
  const depois = await relatar(ana, avaliacao.id, perdaDeFoco(5));
  assert.equal(depois.status, 200);
  assert.equal(depois.body.bloqueada, true);
  assert.equal(depois.body.encerradaAgora, false);
  assert.equal((await query('SELECT count(*)::int AS n FROM evento_monitoramento')).rows[0].n, 1);
});

test('o limite conta só as ocorrências do próprio estudante', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: 3 });
  const ana = await entrar(ANA.email);
  const bruno = await entrar(BRUNO.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await bruno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  await relatar(ana, avaliacao.id, perdaDeFoco(2));
  const r = await relatar(bruno, avaliacao.id, perdaDeFoco(2));

  assert.equal(r.body.ocorrencias, 2, 'as ocorrências da Ana não entram na conta do Bruno');
  assert.equal(r.body.bloqueada, false);
});

// ------------------------------------------------------------------ acesso

test('quem não iniciou a prova não relata evento', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);

  const r = await relatar(ana, avaliacao.id, perdaDeFoco(1));
  assert.equal(r.status, 404);
});

test('a rota de eventos é só do estudante', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  assert.equal((await relatar(prof, avaliacao.id, perdaDeFoco(1))).status, 403);
  assert.equal(
    (await request(app).post(`/api/estudante/avaliacoes/${avaliacao.id}/eventos`).send({ eventos: perdaDeFoco(1) })).status,
    401,
  );
});

// ------------------------------------------------- o professor consulta (UC10)

test('o professor vê o resumo por estudante, do maior para o menor', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const bruno = await entrar(BRUNO.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await bruno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  await relatar(ana, avaliacao.id, [{ tipo: 'PERDA_FOCO' }]);
  await relatar(bruno, avaliacao.id, [
    { tipo: 'TROCA_ABA' },
    { tipo: 'TROCA_ABA' },
    { tipo: 'ATALHO', detalhe: 'Ctrl+V' },
  ]);

  const r = await prof.get(`/api/monitoramento/${avaliacao.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, true);
  assert.equal(r.body.estudantes[0].nome, 'Bruno', 'quem tem mais ocorrências vem primeiro');
  assert.equal(r.body.estudantes[0].ocorrencias, 3);
  assert.equal(r.body.estudantes[0].porTipo.trocaAba, 2);
  assert.equal(r.body.estudantes[0].porTipo.atalho, 1);
  assert.equal(r.body.estudantes[1].ocorrencias, 1);
});

test('o professor vê a linha do tempo de uma prova', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await relatar(ana, avaliacao.id, [{ tipo: 'PERDA_FOCO' }, { tipo: 'ATALHO', detalhe: 'Ctrl+P' }]);

  const { rows } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  const r = await prof.get(`/api/monitoramento/${avaliacao.id}/tentativas/${rows[0].id}`);

  assert.equal(r.status, 200);
  assert.equal(r.body.estudante, 'Ana');
  assert.equal(r.body.eventos.length, 2);
  assert.equal(r.body.eventos[1].detalhe, 'Ctrl+P');
  assert.ok(r.body.eventos[0].dataHora, 'cada evento tem a hora em que aconteceu');
});

test('avaliação sem provas feitas informa que não há dados', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const r = await prof.get(`/api/monitoramento/${avaliacao.id}`);
  assert.equal(r.body.temDados, false);
  assert.deepEqual(r.body.estudantes, []);
});

test('o relatório é do professor dono; os demais recebem 404 ou 403', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await relatar(ana, avaliacao.id, perdaDeFoco(1));

  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.get(`/api/monitoramento/${avaliacao.id}`)).status, 404);

  // O estudante não enxerga o relatório de ninguém — nem o próprio.
  assert.equal((await ana.get(`/api/monitoramento/${avaliacao.id}`)).status, 403);
  assert.equal((await request(app).get(`/api/monitoramento/${avaliacao.id}`)).status, 401);
});

test('a linha do tempo de uma prova de outro professor não é acessível', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const { rows } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);

  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.get(`/api/monitoramento/${avaliacao.id}/tentativas/${rows[0].id}`)).status, 404);
});

// ------------------------------------------- devolver a prova ao estudante (migração 016)
//
// A regra que estes testes guardam: devolver é continuar a MESMA tentativa (P-04), com as
// respostas preservadas (P-02), e o limite de ocorrências recomeçando — senão quem foi
// bloqueado seria bloqueado de novo no primeiro evento e o perdão duraria um clique.

test('o professor devolve a prova bloqueada e o estudante volta a responder', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: 2 });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  // Duas ocorrências: a prova é encerrada pelo monitoramento.
  await ana
    .post(`/api/estudante/avaliacoes/${avaliacao.id}/eventos`)
    .send({ eventos: [{ tipo: 'PERDA_FOCO' }, { tipo: 'TROCA_ABA' }] });
  const bloqueada = await query('SELECT id, status FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(bloqueada.rows[0].status, 'BLOQUEADA');

  const r = await prof
    .post(`/api/correcao/${avaliacao.id}/tentativas/${bloqueada.rows[0].id}/reabrir`)
    .send({ minutos: 30, motivo: 'Queda de energia na sala' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const { rows } = await query(
    'SELECT status, finalizada_em, motivo_bloqueio, prazo_final FROM tentativa WHERE id = $1',
    [bloqueada.rows[0].id],
  );
  assert.equal(rows[0].status, 'EM_ANDAMENTO');
  assert.equal(rows[0].finalizada_em, null);
  assert.equal(rows[0].motivo_bloqueio, null, 'voltar com o motivo gravado diria ao estudante que ele está bloqueado');
  assert.ok(new Date(rows[0].prazo_final) > new Date(), 'o prazo novo conta a partir de agora');

  // E continua sendo UMA tentativa: a P-04 não foi contornada.
  const { rows: total } = await query('SELECT count(*)::int AS n FROM tentativa WHERE avaliacao_id = $1', [
    avaliacao.id,
  ]);
  assert.equal(total[0].n, 1);
});

test('o limite de ocorrências recomeça depois da devolução', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { limiteOcorrencias: 2 });
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await ana
    .post(`/api/estudante/avaliacoes/${avaliacao.id}/eventos`)
    .send({ eventos: [{ tipo: 'PERDA_FOCO' }, { tipo: 'TROCA_ABA' }] });

  const { rows: t } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  await prof
    .post(`/api/correcao/${avaliacao.id}/tentativas/${t[0].id}/reabrir`)
    .send({ minutos: 30, motivo: 'Bloqueio indevido' });

  // Uma ocorrência nova: com o limite 2, não pode bloquear — as duas antigas não contam.
  const depois = await ana
    .post(`/api/estudante/avaliacoes/${avaliacao.id}/eventos`)
    .send({ eventos: [{ tipo: 'PERDA_FOCO' }] });
  assert.equal(depois.body.ocorrencias, 1, 'a contagem recomeça na devolução');
  assert.equal(depois.body.bloqueada, false);

  // Os eventos antigos continuam gravados: deixam de contar, não de existir.
  const { rows: eventos } = await query('SELECT count(*)::int AS n FROM evento_monitoramento WHERE tentativa_id = $1', [
    t[0].id,
  ]);
  assert.equal(eventos[0].n, 3);
});

test('devolver exige motivo e não vale depois de liberar os resultados', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas: [] });
  const { rows: t } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);

  // Sem motivo não passa: a exceção não pode ser silenciosa.
  const semMotivo = await prof
    .post(`/api/correcao/${avaliacao.id}/tentativas/${t[0].id}/reabrir`)
    .send({ minutos: 30, motivo: '  ' });
  assert.equal(semMotivo.status, 400);

  // Outro professor não devolve prova alheia.
  const outro = await entrar(OUTRO_PROF.email);
  const alheia = await outro
    .post(`/api/correcao/${avaliacao.id}/tentativas/${t[0].id}/reabrir`)
    .send({ minutos: 30, motivo: 'Teste' });
  assert.equal(alheia.status, 404);

  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  const depoisDeLiberar = await prof
    .post(`/api/correcao/${avaliacao.id}/tentativas/${t[0].id}/reabrir`)
    .send({ minutos: 30, motivo: 'Tarde demais' });
  assert.equal(depoisDeLiberar.status, 409, 'mudaria uma nota que o estudante já viu');
});

test('a devolução em lote atinge a turma inteira e fica registrada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  for (const email of [ANA.email, BRUNO.email]) {
    const agente = await entrar(email);
    await agente.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
    await agente.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas: [] });
  }

  const r = await prof
    .post(`/api/correcao/${avaliacao.id}/reabrir`)
    .send({ minutos: 45, motivo: 'Queda de energia no laboratório' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(
    r.body.tentativas.every((t) => t.status === 'EM_ANDAMENTO'),
    'todas voltaram a ficar em andamento',
  );
  assert.ok(r.body.tentativas.every((t) => t.reaberturas === 1));

  // Cada devolução é uma linha: quem, quando e por quê — e a segunda não apaga a primeira.
  const { rows } = await query(
    'SELECT motivo, minutos, situacao_anterior FROM reabertura_tentativa ORDER BY id',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].motivo, 'Queda de energia no laboratório');
  assert.equal(rows[0].minutos, 45);
  assert.equal(rows[0].situacao_anterior, 'FINALIZADA');
});

test('depois da devolucao, o que ja estava respondido nao muda mais', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const daProva = inicio.body.questoes;

  // Responde a PRIMEIRA e deixa a segunda em branco.
  const marcar = (q, texto) => ({
    questaoId: q.questaoId,
    alternativaId: q.alternativas.find((a) => a.texto === texto).id,
  });
  await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(daProva[0], 'Certa')] });

  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas: [] });
  const { rows: t } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  await prof
    .post(`/api/correcao/${avaliacao.id}/tentativas/${t[0].id}/reabrir`)
    .send({ minutos: 30, motivo: 'Queda de energia' });

  // A tela recebe a marca do que esta fechado.
  const estado = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  const salva = estado.body.respostas.find((r) => r.questaoId === daProva[0].questaoId);
  assert.equal(salva.travada, true, 'respondida antes da devolucao: fechada');

  // E o servidor recusa a alteracao, mesmo que a tela deixasse passar.
  const trocar = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(daProva[0], 'Errada')] });
  assert.equal(trocar.status, 409);
  assert.match(trocar.body.erro, /não podem ser alteradas/i);

  // A que estava em branco continua aberta: a devolucao serve para concluir.
  const emBranco = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(daProva[1], 'Certa')] });
  assert.equal(emBranco.status, 200);

  // E o que ele respondeu AGORA ainda pode ser corrigido por ele mesmo.
  const dePois = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(daProva[1], 'Errada')] });
  assert.equal(dePois.status, 200, 'o que foi marcado no tempo novo continua editavel');
});
