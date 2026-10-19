// Etapa 6 — RF08 (UC08) e RF09 (UC09): realizar avaliação e salvar respostas.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { criarUsuario, encerrarBanco, limparDados, prepararBanco } from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const PROF = { nome: 'Prof. A', email: 'prof.a@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ANA = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const BRUNO = { nome: 'Bruno', email: 'bruno@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };

const HORA = 3600 * 1000;
const daqui = (h) => new Date(Date.now() + h * HORA).toISOString();

let idAna;

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  idAna = (await criarUsuario(ANA)).id;
  await criarUsuario(BRUNO);
  await criarUsuario(ADMIN);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Monta uma avaliação publicada com uma objetiva e uma discursiva. A turma vem por
// padrão: toda avaliação pertence a turmas e nenhuma publica sem pelo menos uma. Quem
// precisa montar a própria turma passa `comTurma: false` e `publicar: false`.
async function prepararProva(prof, { duracaoMinutos = 60, dataInicio = daqui(-1), dataFim = daqui(24), comTurma = true, publicar = true } = {}) {
  const objetiva = (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA',
    enunciado: 'Capital de Goiás?',
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Goiânia', correta: true }, { texto: 'Rio Verde', correta: false }],
  })).body.questao;
  const discursiva = (await prof.post('/api/questoes').send({
    tipo: 'DISCURSIVA',
    enunciado: 'Explique o Cerrado.',
    pontuacaoPadrao: 3,
    respostaEsperada: 'Bioma de savana brasileira.',
    criteriosCorrecao: 'Citar savana.',
  })).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova de Geografia',
    descricao: 'Leia com atenção.',
    duracaoMinutos,
    dataInicio,
    dataFim,
  })).body.avaliacao;

  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: objetiva.id }, { questaoId: discursiva.id }],
  });

  let turma = null;
  if (comTurma) {
    turma = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;
    await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  }
  if (publicar) {
    const publicacao = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
    assert.equal(publicacao.status, 200, JSON.stringify(publicacao.body));
  }

  return { avaliacao, objetiva, discursiva, turma };
}

async function entrarNaTurma(estudante, turma) {
  assert.equal((await estudante.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status, 201);
}

// ------------------------------------------------------------------ acesso por perfil

test('somente o estudante acessa a área de realização', async () => {
  assert.equal((await request(app).get('/api/estudante/avaliacoes')).status, 401);
  assert.equal((await (await entrar(PROF.email)).get('/api/estudante/avaliacoes')).status, 403);
  assert.equal((await (await entrar(ADMIN.email)).get('/api/estudante/avaliacoes')).status, 403);
  assert.equal((await (await entrar(ANA.email)).get('/api/estudante/avaliacoes')).status, 200);
});

// -------------------------------------------------- quem vê o quê (RN05 + P-19)

test('privada aparece só para quem está APROVADO em uma turma vinculada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);

  const ana = await entrar(ANA.email);
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 0, 'sem turma, não vê');
  assert.equal((await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}`)).status, 404);

  await entrarNaTurma(ana, turma);
  const lista = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].titulo, 'Prova de Geografia');
  assert.equal(lista[0].professor, PROF.nome);
});

test('solicitação pendente ou recusada não dá acesso', async () => {
  const prof = await entrar(PROF.email);
  // Turma com aprovação: publicar só depois de vincular.
  const { avaliacao } = await prepararProva(prof, { comTurma: false, publicar: false });
  const turma = (await prof.post('/api/turmas').send({ nome: 'Fechada', requerAprovacao: true })).body.turma;
  await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);

  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso }); // fica PENDENTE
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 0);

  await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/recusar`);
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 0);

  await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/aprovar`);
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 1);
});

// Antes daqui havia o teste oposto: a avaliação PÚBLICA aparecia para qualquer estudante
// cadastrado, sem turma (P-19). Com a reversão pedida pelo orientador em 13/10/2026 esse
// caminho deixou de existir, e o que precisa de guarda é o contrário: ninguém alcança uma
// prova de turma que não é sua.
test('quem não está numa turma da avaliação não a enxerga', async () => {
  const prof = await entrar(PROF.email);
  const { turma } = await prepararProva(prof);

  // Ana entra na turma pelo código; Bruno fica de fora.
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 1);

  const bruno = await entrar(BRUNO.email);
  assert.equal(
    (await bruno.get('/api/estudante/avaliacoes')).body.avaliacoes.length,
    0,
    'sem vínculo de turma, a prova não existe para o estudante',
  );
});

test('avaliação em rascunho ou arquivada não aparece', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`);
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes.length, 0);
});

test('o estudante nunca recebe gabarito (DT13)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const corpo = JSON.stringify(inicio.body);
  assert.doesNotMatch(corpo, /correta|respostaEsperada|criterios|savana brasileira/i);
  // As alternativas vêm, mas sem dizer qual é a certa.
  assert.equal(inicio.body.questoes[0].alternativas.length, 2);
  assert.ok(inicio.body.questoes[0].alternativas.every((a) => !('correta' in a)));
});

// ---------------------------------------------------- situação da avaliação (A1, A2)

test('A1: avaliação ainda não disponível aparece como AGENDADA e não inicia', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof, { dataInicio: daqui(2), dataFim: daqui(48) });
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.situacao, 'AGENDADA');
  assert.equal(item.podeIniciar, false);
  assert.ok(item.dataInicio, 'a data prevista é informada');

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /ainda não está disponível/);
});

test('A2: período encerrado aparece como ENCERRADA e não inicia', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);
  await query("UPDATE avaliacao SET data_inicio = now() - interval '3 days', data_fim = now() - interval '1 day' WHERE id = $1", [avaliacao.id]);

  const item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.situacao, 'ENCERRADA');

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /encerrado/);
});

// ----------------------------------------------------------- iniciar (UC08, DT06)

test('iniciar registra a tentativa e devolve as questões na ordem', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const antes = Date.now();
  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.avaliacao.situacao, 'EM_ANDAMENTO');
  assert.deepEqual(r.body.questoes.map((q) => q.ordem), [1, 2]);
  assert.deepEqual(r.body.respostas, []);
  assert.ok(r.body.horaServidor, 'a hora do servidor guia o cronômetro');

  // DT06: prazo = início + duração (60 min), porque cabe dentro do período.
  const prazo = new Date(r.body.avaliacao.tentativa.prazoFinal).getTime();
  assert.ok(Math.abs(prazo - (antes + 60 * 60000)) < 5000, 'prazo de 60 minutos a partir de agora');

  const { rows } = await query('SELECT status, iniciada_em, prazo_final FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'EM_ANDAMENTO');
});

test('DT06: o prazo nunca passa do fim do período', async () => {
  const prof = await entrar(PROF.email);
  // Duração de 60 min, mas o período termina em 30.
  const { avaliacao, turma } = await prepararProva(prof, { dataFim: new Date(Date.now() + 30 * 60000).toISOString() });
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const prazo = new Date(r.body.avaliacao.tentativa.prazoFinal).getTime();
  assert.ok(Math.abs(prazo - (Date.now() + 30 * 60000)) < 5000, 'o prazo é o fim do período');
});

test('P-04: iniciar de novo continua a mesma tentativa, e não cria outra', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const primeira = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const segunda = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.avaliacao.tentativa.prazoFinal, primeira.body.avaliacao.tentativa.prazoFinal);

  const { rows } = await query('SELECT count(*)::int AS total FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].total, 1);
});

test('P-04: depois de finalizar, não dá para refazer', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /uma tentativa/i);
});

test('cada estudante tem a própria tentativa', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const bruno = await entrar(BRUNO.email);
  await entrarNaTurma(ana, turma);
  await entrarNaTurma(bruno, turma);

  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  await bruno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const { rows } = await query('SELECT count(*)::int AS total FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].total, 2);
});

test('iniciar trava a avaliação para o professor (P-15a)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.acoes.podeEditar, true);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const depois = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.equal(depois.iniciada, true);
  assert.equal(depois.acoes.podeEditar, false);
  assert.equal(depois.totalTentativas, 1);
});

// ------------------------------------------------------- salvar respostas (UC09)

async function provaEmAndamento() {
  const prof = await entrar(PROF.email);
  const dados = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, dados.turma);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${dados.avaliacao.id}/iniciar`);
  return { ...dados, prof, ana, inicio: inicio.body };
}

test('salvar respostas grava objetiva e discursiva, e informa o horário do salvamento', async () => {
  const { avaliacao, objetiva, discursiva, ana, inicio } = await provaEmAndamento();
  const alternativa = inicio.questoes.find((q) => q.questaoId === objetiva.id).alternativas[0].id;

  const r = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({
    respostas: [
      { questaoId: objetiva.id, alternativaId: alternativa },
      { questaoId: discursiva.id, texto: 'É um bioma de savana.' },
    ],
  });

  assert.equal(r.status, 200);
  assert.ok(r.body.salvoEm, 'a tela usa isto para mostrar "salvo às …"');
  assert.equal(r.body.situacao, 'EM_ANDAMENTO');

  const { rows } = await query('SELECT questao_id, alternativa_id, texto FROM resposta ORDER BY questao_id');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((x) => x.questao_id === objetiva.id).alternativa_id, alternativa);
  assert.equal(rows.find((x) => x.questao_id === discursiva.id).texto, 'É um bioma de savana.');
});

test('salvar de novo a mesma questão atualiza a resposta, sem duplicar (UPSERT)', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();
  const enviar = (texto) => ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto }] });

  await enviar('primeira versão');
  await enviar('versão final');

  const { rows } = await query('SELECT texto FROM resposta WHERE questao_id = $1', [discursiva.id]);
  assert.equal(rows.length, 1, 'uma linha por questão');
  assert.equal(rows[0].texto, 'versão final');
});

test('trocar a alternativa marcada substitui a anterior', async () => {
  const { avaliacao, objetiva, ana, inicio } = await provaEmAndamento();
  const [a1, a2] = inicio.questoes.find((q) => q.questaoId === objetiva.id).alternativas;

  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: objetiva.id, alternativaId: a1.id }] });
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: objetiva.id, alternativaId: a2.id }] });

  const { rows } = await query('SELECT alternativa_id FROM resposta WHERE questao_id = $1', [objetiva.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].alternativa_id, a2.id);
});

test('retomar devolve as respostas já salvas (UC09 A2)', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'rascunho' }] });

  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  assert.equal(r.status, 200);
  assert.equal(r.body.avaliacao.situacao, 'EM_ANDAMENTO');
  assert.deepEqual(r.body.respostas.map((x) => [x.questaoId, x.texto]), [[discursiva.id, 'rascunho']]);
  assert.ok(r.body.horaServidor);
});

test('resposta para questão de fora da prova ou alternativa de outra questão é recusada', async () => {
  const { avaliacao, objetiva, ana, prof } = await provaEmAndamento();
  const fora = (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA', enunciado: 'Fora da prova', pontuacaoPadrao: 1,
    alternativas: [{ texto: 'X', correta: true }, { texto: 'Y', correta: false }],
  })).body.questao;

  const questaoFora = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: fora.id, alternativaId: null }] });
  assert.equal(questaoFora.status, 400);

  const alternativaAlheia = (await prof.get(`/api/questoes/${fora.id}`)).body.questao.alternativas[0].id;
  const trocada = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: objetiva.id, alternativaId: alternativaAlheia }] });
  assert.equal(trocada.status, 400);
});

test('um estudante não salva na tentativa de outro', async () => {
  const { avaliacao, discursiva } = await provaEmAndamento();
  const bruno = await entrar(BRUNO.email);

  const r = await bruno.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'invasão' }] });
  assert.ok([404, 409].includes(r.status));
  const { rows } = await query('SELECT count(*)::int AS total FROM resposta');
  assert.equal(rows[0].total, 0);
});

test('não dá para salvar sem ter iniciado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma, discursiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);

  const r = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'x' }] });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /ainda não iniciou/);
});

// --------------------------------------------------------- finalizar (UC08, A3)

test('finalizar encerra a tentativa e preserva as respostas (RN06)', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'resposta' }] });

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.situacao, 'FINALIZADA');
  assert.ok(r.body.finalizadaEm);

  const { rows } = await query('SELECT status, finalizada_em FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].status, 'FINALIZADA');
  assert.ok(rows[0].finalizada_em);
  const { rows: respostas } = await query('SELECT count(*)::int AS total FROM resposta');
  assert.equal(respostas[0].total, 1, 'as respostas continuam armazenadas');
});

test('a entrega pode trazer respostas ainda não salvas', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: discursiva.id, texto: 'escrita no último minuto' }],
  });
  assert.equal(r.status, 200);

  const { rows } = await query('SELECT texto FROM resposta WHERE questao_id = $1', [discursiva.id]);
  assert.equal(rows[0].texto, 'escrita no último minuto');
});

test('depois de finalizar, não se salva mais nada', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});

  const r = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'depois do fim' }] });
  assert.equal(r.status, 409);

  const item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.situacao, 'FINALIZADA');
  assert.equal(item.podeIniciar, false);
  assert.equal(item.podeContinuar, false);
});

test('finalizar duas vezes não quebra nem muda a primeira entrega', async () => {
  const { avaliacao, ana } = await provaEmAndamento();
  const primeira = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});
  const segunda = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});

  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.jaEstavaEncerrada, true);
  assert.equal(new Date(segunda.body.finalizadaEm).toISOString(), new Date(primeira.body.finalizadaEm).toISOString());
});

// ------------------------------------------------------- tempo esgotado (UC08 A4)

test('A4: passado o prazo, a tentativa é encerrada como TEMPO_ESGOTADO', async () => {
  const { avaliacao, discursiva, ana } = await provaEmAndamento();
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'salvo antes do fim' }] });
  // Envelhece o prazo em vez de esperar uma hora.
  await query("UPDATE tentativa SET prazo_final = now() - interval '1 minute' WHERE avaliacao_id = $1", [avaliacao.id]);

  const salvar = await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'tarde demais' }] });
  assert.equal(salvar.status, 409);
  assert.match(salvar.body.erro, /tempo desta avaliação terminou/i);

  const { rows } = await query('SELECT status, finalizada_em, prazo_final FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].status, 'TEMPO_ESGOTADO');
  // A prova acabou na hora do prazo, não na hora em que alguém percebeu.
  assert.equal(new Date(rows[0].finalizada_em).getTime(), new Date(rows[0].prazo_final).getTime());

  const { rows: resposta } = await query('SELECT texto FROM resposta WHERE questao_id = $1', [discursiva.id]);
  assert.equal(resposta[0].texto, 'salvo antes do fim', 'o que estava salvo é preservado');
});

test('A4: retomar depois do prazo mostra a tentativa encerrada', async () => {
  const { avaliacao, ana } = await provaEmAndamento();
  await query("UPDATE tentativa SET prazo_final = now() - interval '1 minute' WHERE avaliacao_id = $1", [avaliacao.id]);

  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  assert.equal(r.status, 200);
  assert.equal(r.body.avaliacao.situacao, 'TEMPO_ESGOTADO');
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0].podeContinuar, false);
});

test('A4: finalizar depois do prazo devolve o encerramento por tempo', async () => {
  const { avaliacao, ana } = await provaEmAndamento();
  await query("UPDATE tentativa SET prazo_final = now() - interval '1 minute' WHERE avaliacao_id = $1", [avaliacao.id]);

  const r = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body.situacao, 'TEMPO_ESGOTADO');
  assert.equal(r.body.jaEstavaEncerrada, true);
});

test('quem começou continua podendo entregar mesmo se o professor arquivar a avaliação', async () => {
  const { avaliacao, ana, prof } = await provaEmAndamento();
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`)).status, 200);

  assert.equal((await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`)).status, 200);
  assert.equal((await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({})).body.situacao, 'FINALIZADA');
});

test('nenhuma resposta é apagada em todo o fluxo', async () => {
  const { avaliacao, objetiva, discursiva, ana, inicio } = await provaEmAndamento();
  const alternativa = inicio.questoes.find((q) => q.questaoId === objetiva.id).alternativas[0].id;

  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: alternativa }, { questaoId: discursiva.id, texto: 'a' }],
  });
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [{ questaoId: discursiva.id, texto: 'b' }] });
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({});

  const { rows } = await query('SELECT count(*)::int AS total FROM resposta');
  assert.equal(rows[0].total, 2, 'uma linha por questão, atualizadas no lugar');
});

// --------------------------------- travar ao voltar à prova (migração 017)
//
// A regra: o que foi respondido ANTES de sair fica como está. Recarregar a página conta
// como sair, e isso é consequência assumida — a prova é uma sequência de respostas
// confirmadas, não um formulário aberto até o fim.

test('ao voltar à prova, o que já estava respondido não muda mais', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const questoes = inicio.body.questoes;
  const objetiva = questoes.find((q) => q.tipo === 'OBJETIVA');

  const marcar = (indice) => ({
    questaoId: objetiva.questaoId,
    alternativaId: objetiva.alternativas[indice].id,
  });

  // Responde e, na MESMA sessão, troca de ideia: isso continua valendo.
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({ respostas: [marcar(0)] });
  const naMesmaSessao = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(1)] });
  assert.equal(naMesmaSessao.status, 200, 'antes de sair, ainda dá para corrigir o que marcou');

  // Sai e volta: é a chamada que a tela faz ao carregar.
  const retomada = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  assert.equal(retomada.status, 200);
  const salva = retomada.body.respostas.find((r) => r.questaoId === objetiva.questaoId);
  assert.equal(salva.travada, true, 'ao voltar, a resposta anterior aparece fechada');

  const depois = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [marcar(0)] });
  assert.equal(depois.status, 409);
  assert.match(depois.body.erro, /não podem ser alteradas/i);
});

test('a entrega não perde as respostas novas por causa de uma travada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await entrarNaTurma(ana, turma);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const primeira = inicio.body.questoes.find((q) => q.tipo === 'OBJETIVA');
  const segunda = inicio.body.questoes.find((q) => q.tipo === 'DISCURSIVA');

  await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: primeira.questaoId, alternativaId: primeira.alternativas[0].id }] });
  await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`); // volta: a primeira trava

  // A entrega manda as DUAS, como faria uma aba aberta desde antes. A travada é
  // descartada, e a nova precisa sobreviver.
  const entrega = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [
      { questaoId: primeira.questaoId, alternativaId: primeira.alternativas[1].id },
      { questaoId: segunda.questaoId, texto: 'Resposta escrita durante o tempo novo.' },
    ],
  });
  assert.equal(entrega.status, 200);

  const { rows } = await query(
    `SELECT r.questao_id FROM resposta r JOIN tentativa t ON t.id = r.tentativa_id
      WHERE t.avaliacao_id = $1`,
    [avaliacao.id],
  );
  assert.equal(rows.length, 2, 'a resposta nova foi gravada, apesar da travada no mesmo lote');
});
