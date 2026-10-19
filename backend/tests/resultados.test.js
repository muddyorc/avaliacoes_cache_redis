// Etapa 8 — RF13: consulta de resultados pelo professor (UC13 A2).
//
// O que estes testes protegem, além do caminho feliz:
//
//   - o recorte por dono: professor nenhum vê turma alheia, e nenhum outro perfil entra;
//   - a diferença deliberada em relação ao dashboard (RF12): aqui prova aguardando
//     correção **aparece**, sem nota, porque é trabalho pendente e não desempenho ruim;
//   - quem saiu da turma continua no histórico (P-24): é a regra que mais facilmente se
//     perderia numa refatoração, porque "listar os estudantes da turma" parece significar
//     só os ativos.
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
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };
const ALUNOS = ['ana', 'bruno', 'carla'].map((n) => ({
  nome: n[0].toUpperCase() + n.slice(1),
  email: `${n}@exemplo.com`,
  senha: SENHA,
  perfil: 'ESTUDANTE',
}));

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(OUTRO_PROF);
  await criarUsuario(ADMIN);
  for (const aluno of ALUNOS) await criarUsuario(aluno);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Prova com uma objetiva (2 pontos) e uma discursiva (3 pontos) — total 5.
async function prepararProva(prof, { titulo = 'Prova 1' } = {}) {
  const objetiva = (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA',
    enunciado: `Capital de Goiás? (${titulo})`,
    pontuacaoPadrao: 2,
    alternativas: [{ texto: 'Rio Verde', correta: false }, { texto: 'Goiânia', correta: true }],
  })).body.questao;
  const discursiva = (await prof.post('/api/questoes').send({
    tipo: 'DISCURSIVA',
    enunciado: `Explique o Cerrado. (${titulo})`,
    pontuacaoPadrao: 3,
  })).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo,
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: objetiva.id }, { questaoId: discursiva.id }],
  });
  // Não publica aqui: toda avaliação precisa de turma vinculada para ser publicada
  // (reversão do P-19), e as turmas deste arquivo são montadas por cada teste.
  // A publicação acontece logo depois do vínculo.
  return { avaliacao, objetiva, discursiva };
}

async function criarTurmaCom(prof, nome, alunos) {
  const turma = (await prof.post('/api/turmas').send({ nome })).body.turma;
  for (const aluno of alunos) {
    const estudante = await entrar(aluno.email);
    assert.equal(
      (await estudante.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status,
      201,
    );
  }
  return turma;
}

// Faz a prova e, se `notaDiscursiva` vier, o professor corrige. Sem ela, a prova fica
// aguardando correção — o estado que esta tela precisa mostrar.
async function fazerProva(prof, { avaliacao, objetiva, discursiva }, aluno, { acerto, notaDiscursiva }) {
  const estudante = await entrar(aluno.email);
  const inicio = await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alts = inicio.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas;
  await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [
      { questaoId: objetiva.id, alternativaId: acerto ? alts[1].id : alts[0].id },
      { questaoId: discursiva.id, texto: 'o Cerrado é um bioma de savana' },
    ],
  });

  const painel = await prof.get(`/api/correcao/${avaliacao.id}`);
  const tentativa = painel.body.tentativas.find((t) => t.estudante.email === aluno.email);
  if (notaDiscursiva !== undefined) {
    const r = await prof
      .put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`)
      .send({ correcoes: [{ questaoId: discursiva.id, nota: notaDiscursiva }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  return tentativa;
}

// ------------------------------------------------------------------ acesso por perfil

test('a consulta de resultados é só do professor, e só das próprias turmas', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);

  assert.equal((await request(app).get('/api/resultados')).status, 401);
  assert.equal((await (await entrar(ALUNOS[0].email)).get('/api/resultados')).status, 403);
  assert.equal((await (await entrar(ADMIN.email)).get('/api/resultados')).status, 403);

  // O outro professor não vê a turma nem na lista nem pelo identificador direto.
  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.get('/api/resultados')).body.turmas.length, 0);
  assert.equal((await outro.get(`/api/resultados/turmas/${turma.id}`)).status, 404);
  assert.equal((await outro.get(`/api/resultados/turmas/${turma.id}/estudantes/1`)).status, 404);
});

test('id inexistente ou inválido não quebra a consulta', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);

  assert.equal((await prof.get('/api/resultados/turmas/999999')).status, 404);
  assert.equal((await prof.get('/api/resultados/turmas/abc')).status, 400);
  // Estudante que existe, mas não participa desta turma.
  const { rows } = await query('SELECT id FROM usuario WHERE email = $1', [ALUNOS[2].email]);
  assert.equal((await prof.get(`/api/resultados/turmas/${turma.id}/estudantes/${rows[0].id}`)).status, 404);
  assert.equal((await prof.get(`/api/resultados/turmas/${turma.id}/estudantes/999999`)).status, 404);
});

// ------------------------------------------------------- o que existe para consultar

test('a lista traz as turmas do professor com o tamanho do histórico de cada uma', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0], ALUNOS[1]]);
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  await criarTurmaCom(prof, 'Turma vazia', []);

  await fazerProva(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });
  await fazerProva(prof, prova, ALUNOS[1], { acerto: false }); // fica aguardando correção

  const r = await prof.get('/api/resultados');
  assert.equal(r.status, 200);
  const porNome = Object.fromEntries(r.body.turmas.map((t) => [t.nome, t]));

  assert.equal(porNome['Turma A'].totalEstudantes, 2);
  assert.equal(porNome['Turma A'].totalAvaliacoes, 1);
  assert.equal(porNome['Turma A'].provasRealizadas, 2);
  assert.equal(porNome['Turma A'].provasCorrigidas, 1, 'a de Bruno ainda não foi corrigida');

  assert.equal(porNome['Turma vazia'].provasRealizadas, 0);
  assert.equal(porNome['Turma vazia'].totalAvaliacoes, 0);
});

// --------------------------------------------------------------- histórico da turma

test('o quadro da turma cruza cada estudante com cada avaliação', async () => {
  const prof = await entrar(PROF.email);
  const primeira = await prepararProva(prof, { titulo: 'Prova 1' });
  const segunda = await prepararProva(prof, { titulo: 'Prova 2' });
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0], ALUNOS[1]]);
  for (const prova of [primeira, segunda]) {
    await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
    assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  }

  await fazerProva(prof, primeira, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 5 de 5 = 100%
  await fazerProva(prof, segunda, ALUNOS[0], { acerto: true, notaDiscursiva: 0 }); // 2 de 5 = 40%
  await fazerProva(prof, primeira, ALUNOS[1], { acerto: false, notaDiscursiva: 0 }); // 0%

  const r = await prof.get(`/api/resultados/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, true);
  assert.equal(r.body.avaliacoes.length, 2);
  assert.equal(r.body.resumo.provasRealizadas, 3);
  assert.equal(r.body.resumo.provasCorrigidas, 3);

  const porNome = Object.fromEntries(r.body.estudantes.map((e) => [e.nome, e]));

  const ana = porNome.Ana;
  assert.equal(ana.realizadas, 2);
  assert.equal(ana.mediaPercentual, 70, 'média de 100% e 40%');
  assert.equal(ana.provas[primeira.avaliacao.id].pontuacaoTotal, 5);
  assert.equal(ana.provas[primeira.avaliacao.id].percentual, 100);
  assert.equal(ana.provas[segunda.avaliacao.id].percentual, 40);

  const bruno = porNome.Bruno;
  assert.equal(bruno.realizadas, 1);
  assert.equal(bruno.naoRealizadas, 1);
  assert.equal(bruno.mediaPercentual, 0, 'zero é nota, não ausência de nota');
  // A avaliação que ele não fez simplesmente não tem prova: é assim que a tela distingue
  // "não realizou" de "realizou e tirou zero".
  assert.equal(bruno.provas[segunda.avaliacao.id], undefined);
});

test('prova aguardando correção aparece no quadro, sem nota — ao contrário do dashboard', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  await fazerProva(prof, prova, ALUNOS[0], { acerto: true }); // sem nota na discursiva

  const r = await prof.get(`/api/resultados/turmas/${turma.id}`);
  const ana = r.body.estudantes.find((e) => e.nome === 'Ana');

  assert.equal(ana.realizadas, 1);
  assert.equal(ana.aguardandoCorrecao, 1);
  assert.equal(ana.corrigidas, 0);
  assert.equal(ana.mediaPercentual, null, 'sem correção concluída não há média');

  const entrada = ana.provas[prova.avaliacao.id];
  assert.equal(entrada.encerrada, true);
  assert.equal(entrada.correcaoConcluida, false);
  // A soma parcial não pode ser apresentada como nota: a objetiva já vale 2, e mostrar
  // "2 de 5" faria o professor ler como desempenho o que é correção pendente.
  assert.equal(entrada.pontuacaoTotal, null);
  assert.equal(entrada.percentual, null);
  assert.equal(entrada.pontuacaoObjetiva, 2, 'a parte objetiva já é definitiva');
  assert.equal(entrada.podeAbrir, true);
});

test('turma sem avaliação vinculada devolve o motivo, não um quadro vazio', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);

  const r = await prof.get(`/api/resultados/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, false);
  assert.match(r.body.motivoSemDados, /avaliações vinculadas/);
  assert.equal(r.body.estudantes.length, 1, 'os estudantes continuam listados');
});

// ----------------------------------------------------------- histórico do estudante

test('o histórico do estudante lista todas as avaliações da turma, inclusive as que ele não fez', async () => {
  const prof = await entrar(PROF.email);
  const primeira = await prepararProva(prof, { titulo: 'Prova 1' });
  const segunda = await prepararProva(prof, { titulo: 'Prova 2' });
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);
  for (const prova of [primeira, segunda]) {
    await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
    assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  }
  await fazerProva(prof, primeira, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });

  const { rows } = await query('SELECT id FROM usuario WHERE email = $1', [ALUNOS[0].email]);
  const r = await prof.get(`/api/resultados/turmas/${turma.id}/estudantes/${rows[0].id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.estudante.nome, 'Ana');
  assert.equal(r.body.estudante.vinculo, 'APROVADA');
  assert.equal(r.body.resumo.avaliacoes, 2);
  assert.equal(r.body.resumo.realizadas, 1);
  assert.equal(r.body.resumo.naoRealizadas, 1);
  assert.equal(r.body.resumo.mediaPercentual, 100);

  const feita = r.body.avaliacoes.find((a) => a.id === primeira.avaliacao.id);
  assert.equal(feita.pontuacaoMaxima, 5);
  assert.equal(feita.prova.pontuacaoTotal, 5);
  assert.equal(feita.prova.totalDiscursivas, 1);
  assert.equal(feita.prova.discursivasCorrigidas, 1);

  // Ausência é dado: a avaliação não realizada aparece na lista, com `prova` nula.
  const naoFeita = r.body.avaliacoes.find((a) => a.id === segunda.avaliacao.id);
  assert.equal(naoFeita.prova, null);
});

test('o histórico informa se o resultado já foi divulgado ao estudante (P-07)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0]]);
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  await fazerProva(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });

  const { rows } = await query('SELECT id FROM usuario WHERE email = $1', [ALUNOS[0].email]);
  const caminho = `/api/resultados/turmas/${turma.id}/estudantes/${rows[0].id}`;

  // Corrigida, mas ainda não liberada: o professor vê a nota, o estudante não.
  let r = await prof.get(caminho);
  assert.equal(r.body.avaliacoes[0].resultadosLiberados, false);
  assert.equal(r.body.avaliacoes[0].prova.pontuacaoTotal, 5);

  assert.equal((await prof.post(`/api/correcao/${prova.avaliacao.id}/liberar`)).status, 200);
  r = await prof.get(caminho);
  assert.equal(r.body.avaliacoes[0].resultadosLiberados, true);
});

// ------------------------------------------------------------------- P-24: quem saiu

test('quem saiu da turma continua no histórico, marcado, e as provas dele continuam contando', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  const turma = await criarTurmaCom(prof, 'Turma A', [ALUNOS[0], ALUNOS[1]]);
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);
  await fazerProva(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });

  const ana = await entrar(ALUNOS[0].email);
  assert.equal((await ana.post(`/api/estudante/turmas/${turma.id}/sair`)).status, 200);

  const r = await prof.get(`/api/resultados/turmas/${turma.id}`);
  const dela = r.body.estudantes.find((e) => e.nome === 'Ana');
  assert.ok(dela, 'quem saiu não desaparece do histórico da turma');
  assert.equal(dela.vinculo, 'SAIU');
  assert.ok(dela.saiuEm, 'a data da saída fica registrada');
  assert.equal(dela.provas[prova.avaliacao.id].pontuacaoTotal, 5);
  assert.equal(r.body.resumo.provasRealizadas, 1, 'a prova dela continua contando na turma');
  assert.equal(r.body.turma.totalSairam, 1);
  assert.equal(r.body.turma.totalEstudantes, 1, 'o total de ativos não a inclui mais');

  // E o histórico individual dela continua acessível ao professor.
  const { rows } = await query('SELECT id FROM usuario WHERE email = $1', [ALUNOS[0].email]);
  const individual = await prof.get(`/api/resultados/turmas/${turma.id}/estudantes/${rows[0].id}`);
  assert.equal(individual.status, 200);
  assert.equal(individual.body.estudante.vinculo, 'SAIU');
  assert.equal(individual.body.resumo.realizadas, 1);
});

test('solicitação pendente ou recusada não entra na consulta', async () => {
  const prof = await entrar(PROF.email);
  // Turma com aprovação manual: o vínculo nasce PENDENTE.
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma A', requerAprovacao: true })).body.turma;
  const ana = await entrar(ALUNOS[0].email);
  assert.equal((await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status, 201);

  const r = await prof.get(`/api/resultados/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.estudantes.length, 0, 'quem ainda não foi aprovado nunca participou');
});
