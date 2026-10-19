// Etapa 7 (parcial) — RF11: correção automática das objetivas, correção manual das
// discursivas pelo professor e liberação dos resultados (UC11, P-07, P-08, P-12, RN04).
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
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(OUTRO_PROF);
  await criarUsuario(ANA);
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

// Prova com uma objetiva (2 pontos) e uma discursiva (3 pontos), aplicada a uma turma
// com Ana e Bruno — toda avaliação pertence a turmas desde a reversão do P-19.
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
    respostaEsperada: 'Bioma de savana; berço das águas.',
    criteriosCorrecao: 'Citar savana (1,5) e nascentes (1,5).',
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

// Estudante faz e entrega a prova. `acerto` escolhe a alternativa certa ou errada.
async function fazerProva(email, avaliacao, objetiva, discursiva, { acerto = true, texto = 'É um bioma de savana.' } = {}) {
  const estudante = await entrar(email);
  const inicio = await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(inicio.status, 200, JSON.stringify(inicio.body));
  const alternativas = inicio.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas;
  const escolhida = acerto ? alternativas[1].id : alternativas[0].id;

  const respostas = [{ questaoId: objetiva.id, alternativaId: escolhida }];
  if (texto !== null) respostas.push({ questaoId: discursiva.id, texto });
  await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({ respostas });
  return estudante;
}

async function tentativaDe(email) {
  const { rows } = await query(
    'SELECT t.* FROM tentativa t JOIN usuario u ON u.id = t.estudante_id WHERE lower(u.email) = $1',
    [email],
  );
  return rows[0];
}

// ------------------------------------------------------------------ acesso por perfil

test('somente o professor dono acessa a correção', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);

  assert.equal((await request(app).get(`/api/correcao/${avaliacao.id}`)).status, 401);
  assert.equal((await (await entrar(ANA.email)).get(`/api/correcao/${avaliacao.id}`)).status, 403);
  assert.equal((await (await entrar(ADMIN.email)).get(`/api/correcao/${avaliacao.id}`)).status, 403);
  assert.equal((await (await entrar(OUTRO_PROF.email)).get(`/api/correcao/${avaliacao.id}`)).status, 404);
  assert.equal((await prof.get(`/api/correcao/${avaliacao.id}`)).status, 200);
});

// -------------------------------------------- correção automática das objetivas (P-12)

test('ao entregar, a objetiva certa já vale a pontuação da avaliação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });

  const tentativa = await tentativaDe(ANA.email);
  assert.equal(tentativa.pontuacao_objetiva, 2);
  assert.equal(tentativa.correcao_concluida, false, 'falta a discursiva');
  assert.equal(tentativa.pontuacao_total, null, 'nota total só depois da correção completa');

  const { rows } = await query('SELECT correta, nota_final FROM resposta WHERE questao_id = $1', [objetiva.id]);
  assert.equal(rows[0].correta, true);
  assert.equal(rows[0].nota_final, 2);
});

test('avaliação só de objetivas já sai da entrega com a correção concluída', async () => {
  const prof = await entrar(PROF.email);
  const objetiva = (await prof.post('/api/questoes').send({
    tipo: 'OBJETIVA',
    enunciado: 'Maior bioma do Centro-Oeste?',
    pontuacaoPadrao: 4,
    alternativas: [{ texto: 'Cerrado', correta: true }, { texto: 'Caatinga', correta: false }],
  })).body.questao;
  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova objetiva',
    duracaoMinutos: 30,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await vincularTurmaComEstudantes(avaliacao.id, [ANA.email]);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: objetiva.id }] });
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);

  const estudante = await entrar(ANA.email);
  const inicio = await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const alternativas = inicio.body.questoes[0].alternativas;
  await estudante.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: alternativas.find((a) => a.texto === 'Cerrado').id }],
  });

  // Sem discursiva não há nada para o professor corrigir: a prova não pode ficar
  // "aguardando correção" à espera de alguém abrir a tela de correção.
  const tentativa = await tentativaDe(ANA.email);
  assert.equal(tentativa.correcao_concluida, true);
  assert.equal(Number(tentativa.pontuacao_total), 4);

  // E, mesmo assim, a nota só chega ao estudante depois da liberação (P-07).
  const antes = (await estudante.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(antes.resultado, null);
  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);
  const depois = (await estudante.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(depois.resultado.nota, 4);
});

test('objetiva errada vale 0 e o sistema registra que errou', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(BRUNO.email, avaliacao, objetiva, discursiva, { acerto: false });

  assert.equal((await tentativaDe(BRUNO.email)).pontuacao_objetiva, 0);
  const { rows } = await query('SELECT correta, nota_final FROM resposta WHERE questao_id = $1', [objetiva.id]);
  assert.equal(rows[0].correta, false);
  assert.equal(rows[0].nota_final, 0);
});

test('P-12: objetiva não respondida vale 0, sem criar resposta falsa', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);

  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  // Responde só a discursiva; a objetiva fica em branco.
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/finalizar`).send({
    respostas: [{ questaoId: discursiva.id, texto: 'resposta' }],
  });

  assert.equal((await tentativaDe(ANA.email)).pontuacao_objetiva, 0);
  const { rows } = await query('SELECT count(*)::int AS total FROM resposta WHERE questao_id = $1', [objetiva.id]);
  assert.equal(rows[0].total, 0, 'questão em branco não vira linha de resposta');
});

test('a prova encerrada por tempo também é corrigida', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);

  const ana = await entrar(ANA.email);
  const inicio = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  const certa = inicio.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas[1].id;
  await ana.put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: certa }, { questaoId: discursiva.id, texto: 'x' }],
  });
  await query("UPDATE tentativa SET prazo_final = now() - interval '1 minute'");
  await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`); // dispara o encerramento

  const tentativa = await tentativaDe(ANA.email);
  assert.equal(tentativa.status, 'TEMPO_ESGOTADO');
  assert.equal(tentativa.pontuacao_objetiva, 2);
  assert.equal((await prof.get(`/api/correcao/${avaliacao.id}`)).body.tentativas[0].podeCorrigir, true);
});

// ------------------------------------------------------------------ painel de correção

test('o painel mostra quem fez, o que falta corrigir e a nota das objetivas', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  await fazerProva(BRUNO.email, avaliacao, objetiva, discursiva, { acerto: false });

  const r = await prof.get(`/api/correcao/${avaliacao.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.resumo.total, 2);
  assert.equal(r.body.resumo.aguardandoCorrecao, 2);
  assert.equal(r.body.resumo.podeLiberar, false);

  const ana = r.body.tentativas.find((t) => t.estudante.email === ANA.email);
  assert.equal(ana.pontuacaoObjetiva, 2);
  assert.equal(ana.totalDiscursivas, 1);
  assert.equal(ana.discursivasCorrigidas, 0);
  assert.equal(ana.correcaoConcluida, false);
});

test('prova em andamento aparece no painel, mas não pode ser corrigida', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const painel = (await prof.get(`/api/correcao/${avaliacao.id}`)).body;
  assert.equal(painel.resumo.emAndamento, 1);
  assert.equal(painel.tentativas[0].podeCorrigir, false);

  const tentativa = await tentativaDe(ANA.email);
  const detalhe = await prof.get(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`);
  assert.equal(detalhe.status, 409);
  assert.match(detalhe.body.erro, /ainda está em andamento/);
});

// -------------------------------------------------- a prova aberta para correção (UC11)

test('o professor vê a resposta do estudante, o gabarito e a referência da discursiva', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true, texto: 'Savana com nascentes.' });
  const tentativa = await tentativaDe(ANA.email);

  const r = await prof.get(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.tentativa.estudante.nome, 'Ana');

  const obj = r.body.questoes.find((q) => q.questaoId === objetiva.id);
  assert.equal(obj.correta, true);
  assert.ok(obj.alternativas.some((a) => a.correta), 'o professor vê qual era a correta');

  const dis = r.body.questoes.find((q) => q.questaoId === discursiva.id);
  assert.equal(dis.texto, 'Savana com nascentes.');
  assert.equal(dis.respostaEsperada, 'Bioma de savana; berço das águas.');
  assert.match(dis.criteriosCorrecao, /Citar savana/);
  assert.equal(dis.notaFinal, null, 'ainda não corrigida');
});

// ------------------------------------------- correção manual das discursivas (P-08)

test('o professor dá nota e feedback na discursiva, e a nota total é calculada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  const tentativa = await tentativaDe(ANA.email);

  const r = await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: discursiva.id, nota: 2.5, feedback: 'Faltou citar as nascentes.' }],
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.tentativa.correcaoConcluida, true);
  assert.equal(r.body.tentativa.pontuacaoTotal, 4.5, '2 da objetiva + 2,5 da discursiva');

  const { rows } = await query('SELECT nota_final, feedback_professor, corrigida_por, corrigida_em FROM resposta WHERE questao_id = $1', [discursiva.id]);
  assert.equal(rows[0].nota_final, 2.5);
  assert.equal(rows[0].feedback_professor, 'Faltou citar as nascentes.');
  assert.ok(rows[0].corrigida_por, 'registra quem corrigiu');
  assert.ok(rows[0].corrigida_em);
});

test('corrigir de novo atualiza a nota, sem duplicar a resposta', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  const tentativa = await tentativaDe(ANA.email);
  const corrigir = (nota) => prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota }] });

  await corrigir(1);
  const r = await corrigir(3);
  assert.equal(r.body.tentativa.pontuacaoTotal, 5);

  const { rows } = await query('SELECT count(*)::int AS total FROM resposta WHERE questao_id = $1', [discursiva.id]);
  assert.equal(rows[0].total, 1);
});

test('discursiva deixada em branco pode receber nota, e a linha é criada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: false, texto: null });
  const tentativa = await tentativaDe(ANA.email);

  const detalhe = await prof.get(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`);
  assert.equal(detalhe.body.questoes.find((q) => q.questaoId === discursiva.id).respondida, false);

  const r = await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: discursiva.id, nota: 0, feedback: 'Sem resposta.' }],
  });
  assert.equal(r.body.tentativa.correcaoConcluida, true);
  assert.equal(r.body.tentativa.pontuacaoTotal, 0);
});

test('a nota não pode passar do valor da questão', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);

  const r = await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: discursiva.id, nota: 5 }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /não pode passar de 3/);

  const negativa = await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: discursiva.id, nota: -1 }],
  });
  assert.equal(negativa.status, 400);
});

test('o professor não dá nota manual em questão objetiva (RF11)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);

  const r = await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: objetiva.id, nota: 2 }],
  });
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /corrigidas automaticamente/);
});

test('um professor não corrige a prova de avaliação alheia', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);

  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.get(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`)).status, 404);
  const r = await outro.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({
    correcoes: [{ questaoId: discursiva.id, nota: 3 }],
  });
  assert.equal(r.status, 404);
  assert.equal((await query('SELECT nota_final FROM resposta WHERE questao_id = $1', [discursiva.id])).rows[0].nota_final, null);
});

// -------------------------------------------------- liberar resultados (P-07)

test('P-07: a nota só chega ao estudante depois da liberação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  const ana = await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  const tentativa = await tentativaDe(ANA.email);

  // Antes de corrigir: nada de nota.
  let item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.resultadosLiberados, false);
  assert.equal(item.resultado, null);

  // Corrigida, mas ainda não liberada: continua sem nota.
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.resultado, null, 'sem liberação, sem nota');

  const liberacao = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(liberacao.status, 200);
  assert.equal(liberacao.body.avaliacao.resultadosLiberados, true);

  item = (await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0];
  assert.equal(item.resultadosLiberados, true);
  assert.equal(item.resultado.nota, 5, '2 da objetiva + 3 da discursiva');
  assert.equal(item.resultado.pontuacaoMaxima, 5);
});

test('P-07: não libera com prova sem correção concluída', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  await fazerProva(BRUNO.email, avaliacao, objetiva, discursiva);
  const tentativaAna = await tentativaDe(ANA.email);

  let r = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /2 prova\(s\) sem correção/);

  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativaAna.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  r = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /1 prova\(s\) sem correção/);

  const { rows } = await query('SELECT resultados_liberados FROM avaliacao WHERE id = $1', [avaliacao.id]);
  assert.equal(rows[0].resultados_liberados, false);
});

test('P-07: não libera com prova ainda em andamento', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });

  const bruno = await entrar(BRUNO.email);
  await bruno.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

  const r = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /em andamento/);
});

test('não libera avaliação que ninguém fez, nem libera duas vezes', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);

  const vazia = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(vazia.status, 409);
  assert.match(vazia.body.erro, /Nenhum estudante realizou/);

  await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  assert.equal((await prof.post(`/api/correcao/${avaliacao.id}/liberar`)).status, 200);

  const repetida = await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal(repetida.status, 409);
  assert.match(repetida.body.erro, /já foram liberados/);
});

test('depois de liberar, corrigir de novo atualiza a nota que o estudante vê', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  const ana = await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  const tentativa = await tentativaDe(ANA.email);

  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 1 }] });
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0].resultado.nota, 3);

  // Revisão da nota após a liberação.
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  assert.equal((await ana.get('/api/estudante/avaliacoes')).body.avaliacoes[0].resultado.nota, 5);
});

test('o estudante nunca recebe gabarito nem resposta esperada, mesmo com resultados liberados', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  const ana = await fazerProva(ANA.email, avaliacao, objetiva, discursiva);
  const tentativa = await tentativaDe(ANA.email);
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);

  const corpo = JSON.stringify((await ana.get('/api/estudante/avaliacoes')).body);
  assert.doesNotMatch(corpo, /correta|respostaEsperada|criterios|savana/i);
});

test('nenhuma resposta é apagada em todo o fluxo de correção', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, discursiva } = await prepararProva(prof);
  await fazerProva(ANA.email, avaliacao, objetiva, discursiva, { acerto: true });
  const tentativa = await tentativaDe(ANA.email);

  const antes = (await query('SELECT count(*)::int AS total FROM resposta')).rows[0].total;
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 2 }] });
  await prof.put(`/api/correcao/${avaliacao.id}/tentativas/${tentativa.id}`).send({ correcoes: [{ questaoId: discursiva.id, nota: 3 }] });
  await prof.post(`/api/correcao/${avaliacao.id}/liberar`);

  assert.equal((await query('SELECT count(*)::int AS total FROM resposta')).rows[0].total, antes);
});
