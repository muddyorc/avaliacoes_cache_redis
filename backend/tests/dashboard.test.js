// Etapa 10 — RF12: dashboard de desempenho (UC12, incluindo A1 e A2) e P-14.
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
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };
// Quatro estudantes para a média e a distribuição fazerem sentido.
const ALUNOS = ['ana', 'bruno', 'carla', 'davi'].map((n) => ({
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

// Prova pública com uma objetiva (2 pontos) e uma discursiva (3 pontos) — total 5.
// `turmaCom` e `publicar`: toda avaliação precisa de turma vinculada para ser publicada
// (reversão do P-19). O padrão monta uma turma com os quatro alunos, que é o que a maioria
// dos testes daqui quer. Os que montam a própria turma passam `turmaCom: []` e
// `publicar: false` — com duas turmas, a prova deixa de registrar em qual foi feita
// (`turmaDaProva` devolve nulo) e o recorte por turma perderia o sentido.
async function prepararProva(prof, { titulo = 'Prova de Geografia', turmaCom = ALUNOS.map((a) => a.email), publicar = true } = {}) {
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
  if (turmaCom.length > 0) await vincularTurmaComEstudantes(avaliacao.id, turmaCom);
  if (publicar) assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, objetiva, discursiva };
}

// Prova só de objetivas, com quantas questões forem necessárias para os destaques
// terem os dois lados preenchidos.
async function prepararProvaLonga(prof, quantidade) {
  // Mesma regra da `prepararProva`: sem turma não há publicação.
  const questoes = [];
  for (let i = 1; i <= quantidade; i += 1) {
    const q = (await prof.post('/api/questoes').send({
      tipo: 'OBJETIVA',
      enunciado: `Questão ${i} da prova longa?`,
      pontuacaoPadrao: 1,
      alternativas: [{ texto: 'Certa', correta: true }, { texto: 'Errada', correta: false }],
    })).body.questao;
    questoes.push(q);
  }
  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: `Prova longa ${Date.now()}`,
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: questoes.map((q) => ({ questaoId: q.id })),
  });
  await vincularTurmaComEstudantes(avaliacao.id, ALUNOS.map((a) => a.email));
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, questoes };
}

// O estudante acerta as `acertos` primeiras questões e erra o resto.
async function fazerProvaLonga(prof, { avaliacao }, aluno, acertos) {
  const estudante = await entrar(aluno.email);
  const inicio = await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const respostas = inicio.body.questoes.map((q, i) => ({
    questaoId: q.questaoId,
    alternativaId: q.alternativas.find((a) => (i < acertos ? a.texto === 'Certa' : a.texto === 'Errada')).id,
  }));
  await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas });
}

// Faz a prova e, se `notaDiscursiva` vier, o professor corrige.
async function fazerECorrigir(prof, { avaliacao, objetiva, discursiva }, aluno, { acerto, notaDiscursiva }) {
  const estudante = await entrar(aluno.email);
  const inicio = await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alts = inicio.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas;
  await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [
      { questaoId: objetiva.id, alternativaId: acerto ? alts[1].id : alts[0].id },
      { questaoId: discursiva.id, texto: 'resposta' },
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

test('somente o professor vê o dashboard, e só dos próprios dados', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);

  assert.equal((await request(app).get('/api/dashboard')).status, 401);
  assert.equal((await (await entrar(ALUNOS[0].email)).get('/api/dashboard')).status, 403);
  assert.equal((await (await entrar(ADMIN.email)).get('/api/dashboard')).status, 403);

  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.get(`/api/dashboard/avaliacoes/${avaliacao.id}`)).status, 404);
  assert.equal((await outro.get('/api/dashboard')).body.avaliacoes.length, 0);
});

// ------------------------------------------------------- o que há para analisar

test('a lista de análise traz avaliações e turmas, marcando o que ainda não tem dados', async () => {
  const prof = await entrar(PROF.email);
  // A turma vem da própria `prepararProva`: toda avaliação precisa de uma para ser
  // publicada, então criar outra aqui só inflaria a contagem.
  const prova = await prepararProva(prof);

  let fontes = (await prof.get('/api/dashboard')).body;
  assert.equal(fontes.avaliacoes.length, 1);
  assert.equal(fontes.avaliacoes[0].temDados, false, 'ninguém fez a prova ainda');
  assert.equal(fontes.turmas.length, 1);

  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });
  fontes = (await prof.get('/api/dashboard')).body;
  assert.equal(fontes.avaliacoes[0].temDados, true);
  assert.equal(fontes.avaliacoes[0].corrigidas, 1);
});

// --------------------------------------------------------- UC12 A1 e A2 (sem dados)

test('UC12 A2: avaliação sem prova corrigida devolve indicadores indisponíveis, com motivo', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);

  let r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, false);
  assert.match(r.body.motivoSemDados, /Ninguém realizou/);
  assert.equal(r.body.resumo, null);
  assert.deepEqual(r.body.distribuicao, []);

  // Fez a prova, mas a discursiva ainda não foi corrigida.
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true });
  r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.equal(r.body.temDados, false);
  assert.match(r.body.motivoSemDados, /correção concluída/i);
  assert.equal(r.body.participacao.aguardandoCorrecao, 1);
  assert.equal(r.body.resumo, null);
});

test('UC12 A1: turma sem avaliação realizada informa que não há dados', async () => {
  const prof = await entrar(PROF.email);
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;

  const r = await prof.get(`/api/dashboard/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, false);
  assert.match(r.body.motivoSemDados, /não tem avaliações vinculadas/);
  assert.deepEqual(r.body.avaliacoes, []);
});

// --------------------------------------------------- média, distribuição e abaixo

test('média, mediana, extremos e distribuição das notas (UC12, passos 6 e 7)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  // Notas: 5, 3, 2 e 0 de um total de 5 pontos.
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 2 + 3 = 5
  await fazerECorrigir(prof, prova, ALUNOS[1], { acerto: true, notaDiscursiva: 1 }); // 2 + 1 = 3
  await fazerECorrigir(prof, prova, ALUNOS[2], { acerto: false, notaDiscursiva: 2 }); // 0 + 2 = 2
  await fazerECorrigir(prof, prova, ALUNOS[3], { acerto: false, notaDiscursiva: 0 }); // 0

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.equal(r.body.temDados, true);
  assert.equal(r.body.participacao.corrigidas, 4);
  assert.equal(r.body.resumo.media, 2.5);
  assert.equal(r.body.resumo.mediana, 2.5);
  assert.equal(r.body.resumo.menor, 0);
  assert.equal(r.body.resumo.maior, 5);
  assert.equal(r.body.resumo.mediaPercentual, 50);

  // 0 → 0-20%; 2 (40%) → 40-60%; 3 (60%) → 60-80%; 5 (100%) → 80-100%.
  const faixas = Object.fromEntries(r.body.distribuicao.map((f) => [f.faixa, f.total]));
  assert.equal(faixas['0 a 20%'], 1);
  assert.equal(faixas['40 a 60%'], 1);
  assert.equal(faixas['60 a 80%'], 1);
  assert.equal(faixas['80 a 100%'], 1, 'a última faixa inclui o 100%');
  assert.equal(r.body.distribuicao.reduce((t, f) => t + f.total, 0), 4);
});

test('estudantes abaixo da média aparecem do pior para o melhor (UC12, passo 8)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 5
  await fazerECorrigir(prof, prova, ALUNOS[1], { acerto: true, notaDiscursiva: 1 }); // 3
  await fazerECorrigir(prof, prova, ALUNOS[2], { acerto: false, notaDiscursiva: 2 }); // 2
  await fazerECorrigir(prof, prova, ALUNOS[3], { acerto: false, notaDiscursiva: 0 }); // 0

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.deepEqual(r.body.abaixoDaMedia.map((e) => [e.nome, e.nota]), [['Davi', 0], ['Carla', 2]]);
  assert.equal(r.body.abaixoDaMedia[0].percentual, 0);
});

// ------------------------------------------------ índice por questão (P-14)

test('P-14: objetiva usa % de acertos e discursiva usa nota obtida ÷ nota máxima', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  // 3 acertam a objetiva, 1 erra → 75%.
  // Discursiva (vale 3): notas 3, 3, 0, 0 → 6 de 12 → 50%.
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });
  await fazerECorrigir(prof, prova, ALUNOS[1], { acerto: true, notaDiscursiva: 3 });
  await fazerECorrigir(prof, prova, ALUNOS[2], { acerto: true, notaDiscursiva: 0 });
  await fazerECorrigir(prof, prova, ALUNOS[3], { acerto: false, notaDiscursiva: 0 });

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  const objetiva = r.body.questoes.find((q) => q.tipo === 'OBJETIVA');
  const discursiva = r.body.questoes.find((q) => q.tipo === 'DISCURSIVA');

  assert.equal(objetiva.indiceAcerto, 75);
  assert.equal(objetiva.acertos, 3);
  assert.equal(objetiva.totalProvas, 4);
  assert.equal(discursiva.indiceAcerto, 50);
});

test('questões com mais acertos e com mais erros são destacadas (UC12, passos 9 e 10)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 0 });
  await fazerECorrigir(prof, prova, ALUNOS[1], { acerto: true, notaDiscursiva: 0 });

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  // A prova tem duas questões: a objetiva, que todos acertaram, e a discursiva, em que
  // ninguém pontuou. O ranking completo continua em `questoes`.
  assert.equal(r.body.questoes.length, 2);
  const objetiva = r.body.questoes.find((q) => q.tipo === 'OBJETIVA');
  const discursiva = r.body.questoes.find((q) => q.tipo === 'DISCURSIVA');
  assert.equal(objetiva.indiceAcerto, 100, 'todos acertaram a objetiva');
  assert.equal(discursiva.indiceAcerto, 0, 'ninguém pontuou na discursiva');

  // DT60: numa prova curta, as duas listas seriam a mesma invertida. As questões entram
  // no destaque de cima, ordenadas, e o de baixo fica vazio em vez de repeti-las.
  assert.deepEqual(r.body.maioresAcertos.map((q) => q.tipo), ['OBJETIVA', 'DISCURSIVA']);
  assert.deepEqual(r.body.maioresErros, []);
});

test('numa prova longa, os dois destaques trazem questões diferentes (DT60)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProvaLonga(prof, 8);
  // O primeiro estudante acerta as quatro primeiras; o segundo, as mesmas quatro.
  await fazerProvaLonga(prof, prova, ALUNOS[0], 4);
  await fazerProvaLonga(prof, prova, ALUNOS[1], 4);

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.equal(r.body.maioresAcertos.length, 3);
  assert.equal(r.body.maioresErros.length, 3);
  assert.equal(r.body.maioresAcertos[0].indiceAcerto, 100);
  assert.equal(r.body.maioresErros[0].indiceAcerto, 0);

  // Nenhuma questão aparece dos dois lados — é a regra que a tela do professor e o
  // resultado do estudante passaram a ler do mesmo lugar.
  const acertos = new Set(r.body.maioresAcertos.map((q) => q.questaoId));
  assert.ok(r.body.maioresErros.every((q) => !acertos.has(q.questaoId)));
});

test('objetiva não respondida conta como erro no índice (P-12)', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);

  const estudante = await entrar(ALUNOS[0].email);
  await estudante.post(`/api/estudante/avaliacoes/${prova.avaliacao.id}/iniciar`);
  // Entrega sem responder a objetiva.
  await estudante.post(`/api/estudante/avaliacoes/${prova.avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: prova.discursiva.id, texto: 'resposta' }],
  });
  const painel = await prof.get(`/api/correcao/${prova.avaliacao.id}`);
  await prof
    .put(`/api/correcao/${prova.avaliacao.id}/tentativas/${painel.body.tentativas[0].id}`)
    .send({ correcoes: [{ questaoId: prova.discursiva.id, nota: 3 }] });

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  const objetiva = r.body.questoes.find((q) => q.tipo === 'OBJETIVA');
  assert.equal(objetiva.indiceAcerto, 0);
  assert.equal(objetiva.semResposta, 1);
});

// ------------------------------------------------------- provas entregues antes da correção

test('prova entregue antes da correção automática entra no dashboard mesmo assim', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });

  // Simula o estado em que ficaram as provas entregues antes de a correção automática
  // existir: encerradas, porém sem pontuação e sem correção concluída.
  await query(
    `UPDATE tentativa SET pontuacao_objetiva = NULL, pontuacao_total = NULL, correcao_concluida = false
      WHERE avaliacao_id = $1`,
    [prova.avaliacao.id],
  );

  // Abrir o dashboard regulariza sozinho — sem depender de o professor passar antes pela
  // tela de correção, que é o que confundia: "nenhuma prova corrigida" numa prova pronta.
  const fontes = (await prof.get('/api/dashboard')).body;
  assert.equal(fontes.avaliacoes[0].corrigidas, 1);

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`);
  assert.equal(r.body.temDados, true);
  assert.equal(r.body.participacao.corrigidas, 1);
  assert.equal(r.body.resumo.media, 5);
});

// ------------------------------------------------------------- filtro por turma

// Este teste já foi reescrito duas vezes, e as duas por mudança de REGRA, não de código:
//
//   1. nasceu com "Bruno faz a prova sem estar na turma" — possível só enquanto existiu
//      avaliação pública (P-19, revertido em 13/10/2026);
//   2. virou "turma A contra turma B na mesma prova" — possível só enquanto uma prova
//      podia estar em várias turmas (revertido em 15/10/2026).
//
// Com uma turma por prova, o recorte por turma deixou de separar estudantes DENTRO de
// uma avaliação: todos os que a fizeram são da mesma turma. O que o parâmetro ainda
// precisa garantir é que ele não minta — filtrar por outra turma não pode devolver os
// números desta.
test('o filtro por turma devolve a turma da prova, e nada de outra turma', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { turmaCom: [], publicar: false });
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);

  const ana = await entrar(ALUNOS[0].email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 5 de 5

  const daTurma = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`).query({ turmaId: turma.id });
  assert.equal(daTurma.body.turma.nome, 'Turma A');
  assert.equal(daTurma.body.participacao.corrigidas, 1);
  assert.equal(daTurma.body.resumo.media, 5);

  // Filtrar pela turma errada não pode trazer a nota da Ana sob o nome da outra turma.
  const outra = (await prof.post('/api/turmas').send({ nome: 'Turma sem prova' })).body.turma;
  const vazio = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`).query({ turmaId: outra.id });
  assert.equal(vazio.body.turma.nome, 'Turma sem prova');
  assert.equal(vazio.body.temDados, false);
  assert.equal(vazio.body.participacao.corrigidas, 0);
});
test('filtrar por turma que não fez a prova não diz que ninguém realizou', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof);
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma B' })).body.turma;
  // Ana faz a prova, mas não está na Turma B.
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 });

  const r = await prof.get(`/api/dashboard/avaliacoes/${prova.avaliacao.id}`).query({ turmaId: turma.id });
  assert.equal(r.body.temDados, false);
  // Dizer "ninguém realizou" seria falso: Ana realizou, só não é da turma filtrada.
  assert.match(r.body.motivoSemDados, /Ninguém da turma Turma B/);
});

test('turma de outro professor é recusada no filtro', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const outro = await entrar(OUTRO_PROF.email);
  const alheia = (await outro.post('/api/turmas').send({ nome: 'Turma do outro' })).body.turma;

  const r = await prof.get(`/api/dashboard/avaliacoes/${avaliacao.id}`).query({ turmaId: alheia.id });
  assert.equal(r.status, 404);
});

// ------------------------------------------------------------- painel da turma

test('o painel da turma resume as avaliações e o desempenho de cada estudante', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { titulo: 'Prova 1', turmaCom: [], publicar: false });
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);

  for (const aluno of [ALUNOS[0], ALUNOS[1]]) {
    const estudante = await entrar(aluno.email);
    await estudante.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  }
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 5 de 5 = 100%
  await fazerECorrigir(prof, prova, ALUNOS[1], { acerto: false, notaDiscursiva: 0 }); // 0%

  const r = await prof.get(`/api/dashboard/turmas/${turma.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.temDados, true);
  assert.equal(r.body.turma.totalEstudantes, 2);
  assert.equal(r.body.resumo.media, 50, 'média da turma em percentual');

  assert.equal(r.body.avaliacoes.length, 1);
  assert.equal(r.body.avaliacoes[0].titulo, 'Prova 1');
  assert.equal(r.body.avaliacoes[0].tentativas, 2);
  assert.equal(r.body.avaliacoes[0].media, 2.5);
  assert.equal(r.body.avaliacoes[0].participacao, 100);

  const porNome = Object.fromEntries(r.body.estudantes.map((e) => [e.nome, e.mediaPercentual]));
  assert.equal(porNome.Ana, 100);
  assert.equal(porNome.Bruno, 0);
  assert.deepEqual(r.body.abaixoDaMedia.map((e) => e.nome), ['Bruno']);
});

test('estudante da turma que não fez a prova aparece sem média, e não conta como zero', async () => {
  const prof = await entrar(PROF.email);
  const prova = await prepararProva(prof, { turmaCom: [], publicar: false });
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;
  await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${prova.avaliacao.id}/publicar`)).status, 200);

  for (const aluno of [ALUNOS[0], ALUNOS[1]]) {
    const estudante = await entrar(aluno.email);
    await estudante.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  }
  await fazerECorrigir(prof, prova, ALUNOS[0], { acerto: true, notaDiscursiva: 3 }); // 100%

  const r = await prof.get(`/api/dashboard/turmas/${turma.id}`);
  const bruno = r.body.estudantes.find((e) => e.nome === 'Bruno');
  assert.equal(bruno.mediaPercentual, null, 'quem não fez não tem média');
  assert.equal(bruno.provasCorrigidas, 0);
  assert.equal(r.body.resumo.media, 100, 'a média considera só quem fez');
  assert.equal(r.body.avaliacoes[0].participacao, 50, 'metade da turma participou');
});

test('id inexistente ou inválido não quebra o dashboard', async () => {
  const prof = await entrar(PROF.email);
  assert.equal((await prof.get('/api/dashboard/avaliacoes/999999')).status, 404);
  assert.equal((await prof.get('/api/dashboard/turmas/999999')).status, 404);
  assert.equal((await prof.get('/api/dashboard/avaliacoes/abc')).status, 400);
});
