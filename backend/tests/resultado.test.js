// RF13 estendido — o resultado da prova na visão do estudante (decisão de 24/09/2026).
//
// O que este arquivo protege: nada sai sem liberação (P-07); o que é do grupo é anônimo
// e só aparece a partir de um mínimo de provas corrigidas; e o gabarito só vai quando o
// professor marca a opção.
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
// Seis estudantes: o suficiente para passar do piso de anonimato.
const ESTUDANTES = ['ana', 'bruno', 'carla', 'diego', 'elena', 'felipe'].map((nome) => ({
  nome: nome[0].toUpperCase() + nome.slice(1),
  email: `${nome}@exemplo.com`,
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
  for (const e of ESTUDANTES) await criarUsuario(e);
});

after(async () => {
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Prova pública com duas objetivas de 2 pontos: 4 pontos no total.
// `turmaCom` e `publicar` existem porque toda avaliação precisa de turma para ser
// publicada (reversão do P-19). O padrão cobre a maioria dos testes: uma turma com os
// seis estudantes. Os testes que montam as próprias turmas passam `turmaCom: []` e
// `publicar: false`, para não ganharem uma segunda turma — com duas, a prova deixa de
// registrar em qual delas foi feita (`turmaDaProva` devolve nulo) e a comparação por
// turma perderia o sentido.
async function prepararProva(prof, { turmaCom = ESTUDANTES.map((e) => e.email), publicar = true } = {}) {
  const criar = (enunciado, certa) =>
    prof.post('/api/questoes').send({
      tipo: 'OBJETIVA',
      enunciado,
      pontuacaoPadrao: 2,
      alternativas: [{ texto: certa, correta: true }, { texto: 'Alternativa errada', correta: false }],
    });
  const q1 = (await criar('Capital de Goiás?', 'Goiânia')).body.questao;
  const q2 = (await criar('Maior bioma do Centro-Oeste?', 'Cerrado')).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova de Geografia',
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: q1.id }, { questaoId: q2.id }],
  });
  if (turmaCom.length > 0) await vincularTurmaComEstudantes(avaliacao.id, turmaCom);
  if (publicar) assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, q1, q2 };
}

// O estudante faz a prova acertando `acertos` das duas questões.
async function fazerProva(email, avaliacao, acertos) {
  const agente = await entrar(email);
  const inicio = await agente.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const respostas = inicio.body.questoes.map((q, i) => {
    const certa = q.alternativas.find((a) => a.texto !== 'Alternativa errada');
    const errada = q.alternativas.find((a) => a.texto === 'Alternativa errada');
    return { questaoId: q.questaoId, alternativaId: (i < acertos ? certa : errada).id };
  });
  await agente.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas });
  return agente;
}

const divulgar = (prof, avaliacaoId, opcoes) =>
  prof.put(`/api/avaliacoes/${avaliacaoId}/divulgacao`).send(opcoes);

// ------------------------------------------------------------------ P-07

test('sem liberação, o resultado não traz nota nem indicador nenhum', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await fazerProva(ESTUDANTES[0].email, avaliacao, 2);

  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(r.status, 200);
  assert.equal(r.body.liberado, false);
  assert.match(r.body.motivo, /não liberou/i);
  assert.equal(r.body.nota, undefined);
  assert.equal(r.body.questoes, undefined);
  assert.equal(r.body.comparacao, undefined);
});

test('liberado, o estudante vê a própria nota — e só isso, por padrão', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);

  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(r.body.liberado, true);
  assert.equal(r.body.nota.pontos, 4);
  assert.equal(r.body.nota.pontuacaoMaxima, 4);
  assert.equal(r.body.nota.percentual, 100);
  // Nada mais: as opções nascem desmarcadas.
  assert.equal(r.body.questoes, undefined);
  assert.equal(r.body.comparacao, undefined);
});

test('com o período ABERTO, quem ainda não fez a prova não tem resultado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);

  // Bruno ainda TEM direito de fazer a prova: o prazo não venceu. Devolver resultado
  // agora entregaria o gabarito a quem pode começar a prova logo em seguida — é a trava
  // que separa "registrar a ausência" de "distribuir cola".
  const bruno = await entrar(ESTUDANTES[1].email);
  assert.equal((await bruno.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`)).status, 404);
  // O professor não usa esta rota.
  assert.equal((await prof.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`)).status, 403);
});

// ---------------------------------------- a prova de quem não fez (migração 014)
//
// Decisão do autor em 17/10/2026: vencido o prazo, quem não abriu a prova tem a dele
// registrada em branco, com nota zero. Assim o aluno que faltou deixa de ser um caso
// especial em cada consulta — e passa a ver o gabarito como todo mundo.

const encerrarPrazo = (avaliacaoId) =>
  query(
    "UPDATE avaliacao SET data_inicio = now() - interval '3 days', data_fim = now() - interval '1 day' WHERE id = $1",
    [avaliacaoId],
  );

test('vencido o prazo, a prova de quem não fez é registrada em branco, com nota zero', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  await encerrarPrazo(avaliacao.id);

  // Abrir a correção é o que materializa: o sistema não tem processo em segundo plano.
  await prof.get(`/api/correcao/${avaliacao.id}`);

  const { rows } = await query(
    "SELECT status, pontuacao_total, correcao_concluida FROM tentativa WHERE avaliacao_id = $1 AND status = 'NAO_REALIZADA'",
    [avaliacao.id],
  );
  assert.equal(rows.length, ESTUDANTES.length - 1, 'uma por estudante da turma que não fez');
  for (const linha of rows) {
    assert.equal(Number(linha.pontuacao_total), 0);
    assert.equal(linha.correcao_concluida, true, 'não há nada para o professor corrigir');
  }

  // E só uma por estudante, por mais vezes que a materialização rode (P-04).
  await prof.get(`/api/correcao/${avaliacao.id}`);
  await prof.get(`/api/correcao/${avaliacao.id}`);
  const { rows: depois } = await query('SELECT count(*)::int AS total FROM tentativa WHERE avaliacao_id = $1', [
    avaliacao.id,
  ]);
  assert.equal(depois[0].total, ESTUDANTES.length);
});

test('com o período aberto, nenhuma prova em branco é criada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);

  await prof.get(`/api/correcao/${avaliacao.id}`);

  const { rows } = await query('SELECT count(*)::int AS total FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].total, 1, 'enquanto dá para fazer a prova, ninguém faltou ainda');
});

test('quem não fez vê o gabarito depois da liberação, e nota zero', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  await encerrarPrazo(avaliacao.id);
  await divulgar(prof, avaliacao.id, { gabarito: true });
  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);

  const bruno = await entrar(ESTUDANTES[1].email);
  const r = await bruno.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.naoRealizada, true);
  assert.equal(r.body.nota.pontos, 0);
  assert.ok(r.body.questoes, 'o gabarito sai como sai para quem fez');
  assert.match(JSON.stringify(r.body.questoes), /Goiânia/);
});

test('prova em branco não trava a liberação de uma avaliação com discursivas', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);

  // Uma discursiva entra na prova: é o caso em que a correção depende do professor.
  const discursiva = (await prof.post('/api/questoes').send({
    tipo: 'DISCURSIVA',
    enunciado: 'Explique o bioma Cerrado.',
    pontuacaoPadrao: 2,
    respostaEsperada: 'Vegetação de savana brasileira.',
  })).body.questao;
  const atuais = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.questoes;
  await prof
    .put(`/api/avaliacoes/${avaliacao.id}/questoes`)
    .send({ questoes: [...atuais.map((q) => ({ questaoId: q.questaoId })), { questaoId: discursiva.id }] });

  await encerrarPrazo(avaliacao.id);
  const resumo = (await prof.get(`/api/correcao/${avaliacao.id}`)).body;

  assert.equal(resumo.tentativas.length, ESTUDANTES.length, 'a turma inteira tem prova registrada');
  assert.ok(
    resumo.tentativas.every((t) => t.correcaoConcluida),
    'prova sem resposta nenhuma não fica aguardando correção para sempre',
  );
  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);
});

// ------------------------------------------------- o aviso de nota liberada (migração 015)
//
// O sino da barra precisa saber se o estudante já viu a nota — senão "saiu o seu
// resultado" ficaria para sempre na lista. Abrir o resultado é o que marca.

test('abrir o resultado marca que o estudante viu a nota', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await fazerProva(ESTUDANTES[0].email, avaliacao, 2);

  const naoVisto = async () => {
    const { rows } = await query('SELECT visualizado_em FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
    return rows[0].visualizado_em;
  };

  // Antes da liberação, abrir o resultado não marca nada: não há nota para ver.
  await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(await naoVisto(), null, 'sem liberação não há o que visualizar');

  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  const listaAntes = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes;
  assert.equal(
    listaAntes.find((a) => a.id === avaliacao.id).resultado.visualizadoEm,
    null,
    'liberada e ainda não vista: é este o estado que vira aviso',
  );

  await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  const visto = await naoVisto();
  assert.ok(visto, 'abrir o resultado liberado marca a visualização');

  // Abrir de novo não reescreve: a marca é da PRIMEIRA vez.
  await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.deepEqual(await naoVisto(), visto);

  const listaDepois = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes;
  assert.ok(listaDepois.find((a) => a.id === avaliacao.id).resultado.visualizadoEm);
});

// --------------------------------------------------------------- gabarito

test('o gabarito só vai quando o professor marca a opção', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await fazerProva(ESTUDANTES[0].email, avaliacao, 1);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);

  const semGabarito = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(semGabarito.body.questoes, undefined);
  assert.doesNotMatch(JSON.stringify(semGabarito.body), /Goiânia|Cerrado/);

  assert.equal((await divulgar(prof, avaliacao.id, { gabarito: true })).status, 200);

  const comGabarito = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(comGabarito.body.questoes.length, 2);
  const primeira = comGabarito.body.questoes[0];
  assert.equal(primeira.ordem, 1);
  assert.equal(primeira.correta, true, 'acertou a primeira');
  assert.equal(Number(primeira.notaObtida), 2);
  assert.ok(primeira.alternativas.some((a) => a.correta), 'a alternativa correta vem marcada');
  assert.equal(comGabarito.body.questoes[1].correta, false, 'errou a segunda');
});

// ------------------------------------------- agregados anônimos e piso

test('os indicadores da turma só aparecem a partir do mínimo de provas corrigidas', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  // Três provas: abaixo do piso.
  for (const e of ESTUDANTES.slice(0, 3)) await fazerProva(e.email, avaliacao, 2);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  await divulgar(prof, avaliacao.id, { mediaTurma: true, distribuicao: true, questoesDestaque: true });

  const ana = await entrar(ESTUDANTES[0].email);
  const poucos = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(poucos.body.comparacao.suficiente, false);
  assert.equal(poucos.body.comparacao.media, undefined, 'com poucos dados, nem a média sai');
  // Quantas provas existem não é assunto do estudante: a resposta não conta ninguém.
  assert.equal(poucos.body.comparacao.totalProvas, undefined);
  assert.equal(poucos.body.comparacao.minimoNecessario, undefined);
  assert.equal(poucos.body.comparacao.distribuicao, undefined);
  assert.equal(poucos.body.comparacao.destaques, undefined);
  // A nota do próprio estudante continua lá.
  assert.equal(poucos.body.nota.pontos, 4);
});

test('com provas suficientes, os indicadores vêm anônimos', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  // Seis provas, com notas diferentes.
  for (const [i, e] of ESTUDANTES.entries()) await fazerProva(e.email, avaliacao, i % 3);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  await divulgar(prof, avaliacao.id, { mediaTurma: true, distribuicao: true, questoesDestaque: true });

  const ana = await entrar(ESTUDANTES[0].email);
  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  const comparacao = r.body.comparacao;

  assert.equal(comparacao.suficiente, true);
  assert.equal(comparacao.totalProvas, undefined, 'a tela não conta quem fez');
  assert.ok(typeof comparacao.media === 'number');
  assert.equal(comparacao.distribuicao.length, 5);
  assert.ok(comparacao.minhaFaixa, 'a tela precisa saber em que faixa ele caiu');
  assert.ok(comparacao.destaques.maioresAcertos.length > 0);

  // Nenhum nome, e-mail ou nota individual de terceiros.
  const corpo = JSON.stringify(r.body);
  for (const e of ESTUDANTES.slice(1)) {
    assert.doesNotMatch(corpo, new RegExp(e.nome, 'i'));
    assert.doesNotMatch(corpo, new RegExp(e.email, 'i'));
  }
  assert.doesNotMatch(corpo, /abaixoDaMedia|estudantes/i);
});

// A comparação que o estudante vê é da prova DELE, e não uma média de tudo que o
// professor aplicou.
//
// Este teste comparava duas turmas na MESMA prova — cenário que deixou de existir em
// 15/10/2026, quando a avaliação passou a pertencer a uma turma só. A garantia continua
// valendo, só que o vazamento possível agora é outro: uma prova puxar números de outra.
test('a comparação é da própria prova, e não de outras do professor', async () => {
  const prof = await entrar(PROF.email);

  // Duas provas, duas turmas, desempenhos opostos: na primeira todos acertam as duas
  // questões; na segunda, nenhuma.
  const primeira = await prepararProva(prof, { turmaCom: [], publicar: false });
  const turmaA = (await prof.post('/api/turmas').send({ nome: 'Turma A' })).body.turma;
  for (const e of ESTUDANTES) {
    const agente = await entrar(e.email);
    await agente.post('/api/estudante/turmas/entrar').send({ codigo: turmaA.codigoAcesso });
  }
  await prof.post(`/api/avaliacoes/${primeira.avaliacao.id}/turmas`).send({ turmaIds: [turmaA.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${primeira.avaliacao.id}/publicar`)).status, 200);
  for (const e of ESTUDANTES) await fazerProva(e.email, primeira.avaliacao, 2);
  await prof.post(`/api/correcao/${primeira.avaliacao.id}/liberar`);
  await divulgar(prof, primeira.avaliacao.id, { mediaTurma: true, questoesDestaque: true });

  const segunda = await prepararProva(prof, { turmaCom: [], publicar: false });
  const turmaB = (await prof.post('/api/turmas').send({ nome: 'Turma B' })).body.turma;
  const OUTROS = ['gabi', 'hugo', 'iris', 'joao', 'kelly', 'lucas'].map((nome) => ({
    nome: nome[0].toUpperCase() + nome.slice(1),
    email: `${nome}@exemplo.com`,
    senha: SENHA,
    perfil: 'ESTUDANTE',
  }));
  for (const e of OUTROS) await criarUsuario(e);
  for (const e of OUTROS) {
    const agente = await entrar(e.email);
    await agente.post('/api/estudante/turmas/entrar').send({ codigo: turmaB.codigoAcesso });
  }
  await prof.post(`/api/avaliacoes/${segunda.avaliacao.id}/turmas`).send({ turmaIds: [turmaB.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${segunda.avaliacao.id}/publicar`)).status, 200);
  for (const e of OUTROS) await fazerProva(e.email, segunda.avaliacao, 0);
  await prof.post(`/api/correcao/${segunda.avaliacao.id}/liberar`);
  await divulgar(prof, segunda.avaliacao.id, { mediaTurma: true, questoesDestaque: true });

  // Cada estudante compara com a própria prova. Se as duas se misturassem, as médias
  // convergiriam para 2 — e é esse encontro no meio que o teste existe para impedir.
  const daA = await entrar(ESTUDANTES[0].email);
  const a = (await daA.get(`/api/estudante/avaliacoes/${primeira.avaliacao.id}/resultado`)).body;
  assert.equal(a.comparacao.media, 4, 'a média é da primeira prova, não a geral de 2');
  assert.equal(a.comparacao.destaques.todas[0].indiceAcerto, 100);

  const daB = await entrar(OUTROS[0].email);
  const b = (await daB.get(`/api/estudante/avaliacoes/${segunda.avaliacao.id}/resultado`)).body;
  assert.equal(b.comparacao.media, 0);
  assert.equal(b.comparacao.destaques.todas[0].indiceAcerto, 0);
});
test('a prova guarda a turma em que foi feita', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof, { turmaCom: [], publicar: false });
  const turma = (await prof.post('/api/turmas').send({ nome: 'Turma única' })).body.turma;
  const ana = await entrar(ESTUDANTES[0].email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);

  const { rows } = await query('SELECT turma_id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].turma_id, turma.id, 'a turma fica gravada junto da prova');

  // Sair da turma depois não reescreve o histórico da prova já feita.
  await query('DELETE FROM turma_estudante WHERE turma_id = $1', [turma.id]);
  const { rows: depois } = await query('SELECT turma_id FROM tentativa WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(depois[0].turma_id, turma.id, 'o histórico da prova não muda quando o vínculo muda');
});

test('cada indicador respeita a sua caixa de seleção', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  for (const [i, e] of ESTUDANTES.entries()) await fazerProva(e.email, avaliacao, i % 3);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  await divulgar(prof, avaliacao.id, { mediaTurma: true });

  const ana = await entrar(ESTUDANTES[0].email);
  const r = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.ok(typeof r.body.comparacao.media === 'number', 'a média foi marcada');
  assert.equal(r.body.comparacao.distribuicao, undefined, 'a distribuição não');
  assert.equal(r.body.comparacao.destaques, undefined, 'os destaques também não');
});

// ------------------------------------------------- configuração pelo professor

test('a divulgação é do professor dono e pode mudar depois de liberar', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);

  // O estudante não configura nada.
  assert.equal((await ana.put(`/api/avaliacoes/${avaliacao.id}/divulgacao`).send({ gabarito: true })).status, 403);

  // O professor marca depois de liberar…
  await divulgar(prof, avaliacao.id, { gabarito: true });
  assert.ok((await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`)).body.questoes);

  // …e desmarcar volta a esconder.
  await divulgar(prof, avaliacao.id, {});
  assert.equal((await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`)).body.questoes, undefined);

  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.deepEqual(detalhe.divulgacao, {
    gabarito: false,
    mediaTurma: false,
    distribuicao: false,
    questoesDestaque: false,
  });
});

test('a avaliação nasce sem divulgar nada além da nota', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.deepEqual(detalhe.divulgacao, {
    gabarito: false,
    mediaTurma: false,
    distribuicao: false,
    questoesDestaque: false,
  });
});

test('prova em andamento não tem resultado, mesmo com a avaliação liberada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  // Ana entrega; Bruno começa e não entrega.
  await fazerProva(ESTUDANTES[0].email, avaliacao, 2);
  const bruno = await entrar(ESTUDANTES[1].email);
  await bruno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  // Com prova em andamento a liberação é recusada (P-07), então forçamos o cenário.
  await query('UPDATE avaliacao SET resultados_liberados = true WHERE id = $1', [avaliacao.id]);

  const r = await bruno.get(`/api/estudante/avaliacoes/${avaliacao.id}/resultado`);
  assert.equal(r.body.liberado, false);
  assert.match(r.body.motivo, /andamento/i);
  assert.equal(r.body.nota, undefined);
});
