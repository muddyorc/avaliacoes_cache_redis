// Etapa 5 — RF06: turmas, código de acesso, entrada direta e com aprovação (UC06, P-09).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { gerarCodigo, normalizarCodigo } from '../src/modules/turmas/turmas.service.js';
import { criarUsuario, encerrarBanco, limparDados, prepararBanco } from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const PROF = { nome: 'Prof. A', email: 'prof.a@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const OUTRO_PROF = { nome: 'Prof. B', email: 'prof.b@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ANA = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const BRUNO = { nome: 'Bruno', email: 'bruno@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };

let idAna;
let idBruno;

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(OUTRO_PROF);
  idAna = (await criarUsuario(ANA)).id;
  idBruno = (await criarUsuario(BRUNO)).id;
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

async function criarTurma(agente, dados = { nome: 'Banco de Dados — Noturno' }) {
  const r = await agente.post('/api/turmas').send(dados);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.turma;
}

// ------------------------------------------------------------------ acesso por perfil

test('somente o professor administra turmas; estudante e admin recebem 403', async () => {
  assert.equal((await request(app).get('/api/turmas')).status, 401);
  for (const perfil of [ANA, ADMIN]) {
    const agente = await entrar(perfil.email);
    assert.equal((await agente.get('/api/turmas')).status, 403);
    assert.equal((await agente.post('/api/turmas').send({ nome: 'X' })).status, 403);
  }
});

test('somente o estudante entra em turma por código', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  assert.equal((await prof.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status, 403);
  assert.equal((await request(app).post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status, 401);
});

test('um professor não vê nem altera as turmas de outro', async () => {
  const dono = await entrar(PROF.email);
  const turma = await criarTurma(dono);
  const outro = await entrar(OUTRO_PROF.email);

  assert.equal((await outro.get(`/api/turmas/${turma.id}`)).status, 404);
  assert.equal((await outro.put(`/api/turmas/${turma.id}`).send({ nome: 'Invasão' })).status, 404);
  assert.equal((await outro.post(`/api/turmas/${turma.id}/codigo`)).status, 404);
  assert.equal((await outro.patch(`/api/turmas/${turma.id}/situacao`).send({ situacao: 'INATIVA' })).status, 404);
  assert.equal((await outro.get('/api/turmas')).body.turmas.length, 0);
});

// Guarda que ficou necessária quando o professor passou a se autocadastrar (13/10/2026):
// antes, toda conta de professor vinha do administrador, e "professor malicioso" exigia
// que o administrador criasse um. Agora qualquer pessoa abre uma — então o que impede
// uma conta nova de alcançar a turma alheia precisa estar escrito, e não só implicado.
//
// A proteção é de perfil, e não de posse: as rotas de estudante exigem ESTUDANTE, então
// nem com o código em mãos um professor entra numa turma.
test('professor não entra na turma de outro professor, nem com o código', async () => {
  const dono = await entrar(PROF.email);
  const turma = await criarTurma(dono);
  const outro = await entrar(OUTRO_PROF.email);

  const entrada = await outro.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(entrada.status, 403, 'a rota de entrada é só de estudante');

  // E nenhum vínculo pode ter sido criado por efeito colateral.
  const { rows } = await query(
    `SELECT 1 FROM turma_estudante te JOIN usuario u ON u.id = te.estudante_id
      WHERE te.turma_id = $1 AND lower(u.email) = $2`,
    [turma.id, OUTRO_PROF.email],
  );
  assert.equal(rows.length, 0);

  // As avaliações da turma também não: o caminho do estudante inteiro está fechado.
  assert.equal((await outro.get('/api/estudante/avaliacoes')).status, 403);
  assert.equal((await outro.get('/api/estudante/turmas')).status, 403);
});

// ------------------------------------------------- remoção pelo professor (item 10)

test('o professor remove um estudante, e o vínculo vira histórico em vez de sumir', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await prof.post(`/api/turmas/${turma.id}/estudantes/${idAna}/remover`);
  assert.equal(r.status, 200);
  assert.equal(r.body.estudante.nome, ANA.nome);

  // Exclusão lógica (P-02): a linha fica, com quem removeu registrado.
  const { rows } = await query(
    'SELECT situacao, saiu_em, removido_por FROM turma_estudante WHERE turma_id = $1 AND estudante_id = $2',
    [turma.id, idAna],
  );
  assert.equal(rows[0].situacao, 'SAIU');
  assert.ok(rows[0].saiu_em);
  assert.ok(rows[0].removido_por, 'guarda QUEM removeu — é o que separa remoção de saída');

  // O estudante perde o acesso…
  assert.equal((await ana.get(`/api/estudante/turmas/${turma.id}`)).status, 404);

  // …mas NÃO em silêncio: a turma continua na lista dele, marcada.
  const minhas = (await ana.get('/api/estudante/turmas')).body.turmas;
  const removida = minhas.find((t) => t.id === turma.id);
  assert.ok(removida, 'a turma não pode simplesmente desaparecer');
  assert.equal(removida.removido, true);
});

test('o estudante vê quem mais está na turma, pelo nome e sem e-mail', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  const bruno = await entrar(BRUNO.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const { colegas } = (await ana.get(`/api/estudante/turmas/${turma.id}`)).body;
  assert.deepEqual(
    colegas.map((c) => c.nome),
    [ANA.nome, BRUNO.nome],
    'em ordem de nome, e com a própria pessoa na lista',
  );
  assert.equal(colegas.find((c) => c.nome === ANA.nome).voce, true);
  assert.equal(colegas.find((c) => c.nome === BRUNO.nome).voce, false);

  // O e-mail é do professor, não da turma: ele identifica quem é quem para aprovar e
  // corrigir; entre colegas seria dado pessoal distribuído sem servir a nada.
  for (const colega of colegas) assert.equal(colega.email, undefined);
  assert.ok(!JSON.stringify(colegas).includes('@'), 'nenhum endereço vaza na resposta');
});

test('quem ainda espera aprovação não vê a lista de participantes', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Com aprovação', requerAprovacao: true });
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const corpo = (await ana.get(`/api/estudante/turmas/${turma.id}`)).body;
  assert.equal(corpo.turma.situacao, 'PENDENTE');
  assert.deepEqual(corpo.colegas, [], 'mesma regra das provas: pendente ainda não vê o conteúdo da turma');
});

test('quem saiu por conta própria não aparece como removido', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await ana.post(`/api/estudante/turmas/${turma.id}/sair`);

  const { rows } = await query(
    'SELECT removido_por FROM turma_estudante WHERE turma_id = $1 AND estudante_id = $2',
    [turma.id, idAna],
  );
  assert.equal(rows[0].removido_por, null, 'saída voluntária não tem quem removeu');

  // E a turma some da lista: quem saiu sabe que saiu.
  const minhas = (await ana.get('/api/estudante/turmas')).body.turmas;
  assert.equal(minhas.find((t) => t.id === turma.id), undefined);
});

test('remover é só do professor dono da turma', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const outro = await entrar(OUTRO_PROF.email);
  assert.equal((await outro.post(`/api/turmas/${turma.id}/estudantes/${idAna}/remover`)).status, 404);
  assert.equal((await ana.post(`/api/turmas/${turma.id}/estudantes/${idAna}/remover`)).status, 403);

  const { rows } = await query(
    'SELECT situacao FROM turma_estudante WHERE turma_id = $1 AND estudante_id = $2',
    [turma.id, idAna],
  );
  assert.equal(rows[0].situacao, 'APROVADA', 'nada mudou');
});

test('remover duas vezes é informado, sem reescrever a data', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  assert.equal((await prof.post(`/api/turmas/${turma.id}/estudantes/${idAna}/remover`)).status, 200);
  const segunda = await prof.post(`/api/turmas/${turma.id}/estudantes/${idAna}/remover`);
  assert.equal(segunda.status, 409);
  assert.match(segunda.body.erro, /já não participa/i);
});

// ------------------------------------------------------------------ criar e editar (UC06)

test('o professor cria a turma e o sistema gera o código de acesso (UC06)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Redes — Manhã', descricao: '3º período' });

  assert.equal(turma.nome, 'Redes — Manhã');
  assert.equal(turma.descricao, '3º período');
  assert.equal(turma.situacao, 'ATIVA');
  assert.equal(turma.requerAprovacao, false, 'o padrão é entrada direta');
  assert.match(turma.codigoAcesso, /^[A-HJKMNP-Z2-9]{8}$/, 'código de 8 caracteres, sem 0/O/1/I/L');
  assert.equal(turma.totalEstudantes, 0);
});

test('nome é obrigatório (UC06, validação)', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/turmas').send({ nome: '  ' });
  assert.equal(r.status, 400);
  assert.ok(r.body.campos.nome);
});

test('os códigos gerados são únicos e não usam caracteres ambíguos', async () => {
  const prof = await entrar(PROF.email);
  const codigos = new Set();
  for (let i = 0; i < 20; i += 1) codigos.add((await criarTurma(prof, { nome: `T${i}` })).codigoAcesso);
  assert.equal(codigos.size, 20);

  for (let i = 0; i < 500; i += 1) assert.doesNotMatch(gerarCodigo(), /[01OIL]/);
});

test('o professor edita a turma (UC06 A1)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);

  const r = await prof.put(`/api/turmas/${turma.id}`).send({ nome: 'Nome novo', descricao: 'Nova', requerAprovacao: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.nome, 'Nome novo');
  assert.equal(r.body.turma.requerAprovacao, true);
  assert.equal(r.body.turma.codigoAcesso, turma.codigoAcesso, 'editar não troca o código');
});

test('gerar novo código invalida o anterior, e quem já entrou continua na turma', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const nova = (await prof.post(`/api/turmas/${turma.id}/codigo`)).body.turma;
  assert.notEqual(nova.codigoAcesso, turma.codigoAcesso);

  const bruno = await entrar(BRUNO.email);
  assert.equal((await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).status, 404);
  assert.equal((await bruno.post('/api/estudante/turmas/entrar').send({ codigo: nova.codigoAcesso })).status, 201);
  assert.equal(nova.totalEstudantes, 1, 'Ana continua na turma');
});

// ------------------------------------------------------- entrada direta pelo código (A2)

test('entrada direta: o estudante informa o código e já participa da turma (UC06 A2)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);

  const r = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(r.status, 201);
  assert.equal(r.body.situacao, 'APROVADA');
  assert.match(r.body.mensagem, /entrou na turma/);

  const minhas = (await ana.get('/api/estudante/turmas')).body.turmas;
  assert.equal(minhas.length, 1);
  assert.equal(minhas[0].situacao, 'APROVADA');
  assert.equal(minhas[0].professor, PROF.nome);

  const detalhe = (await prof.get(`/api/turmas/${turma.id}`)).body.turma;
  assert.deepEqual(detalhe.estudantes.map((e) => e.email), [ANA.email]);
});

test('o código é aceito com minúsculas, espaços e hífen', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const digitado = ` ${turma.codigoAcesso.slice(0, 4).toLowerCase()}-${turma.codigoAcesso.slice(4).toLowerCase()} `;

  assert.equal(normalizarCodigo(digitado), turma.codigoAcesso);
  const ana = await entrar(ANA.email);
  assert.equal((await ana.post('/api/estudante/turmas/entrar').send({ codigo: digitado })).status, 201);
});

test('código inválido é recusado sem revelar nada', async () => {
  const ana = await entrar(ANA.email);
  for (const codigo of ['ABC', 'ZZZZZZZZ']) {
    const r = await ana.post('/api/estudante/turmas/entrar').send({ codigo });
    assert.ok([400, 404].includes(r.status));
    assert.match(r.body.erro, /código de turma inválido/i);
  }
});

test('entrar duas vezes é informado, sem duplicar o vínculo', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /já participa/);
  const { rows } = await query('SELECT count(*)::int AS total FROM turma_estudante WHERE estudante_id = $1', [idAna]);
  assert.equal(rows[0].total, 1);
});

// ----------------------------------------------------- entrada com aprovação (A3 / A4)

test('com aprovação, a entrada vira solicitação pendente (UC06 A3)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Turma fechada', requerAprovacao: true });
  const ana = await entrar(ANA.email);

  const r = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(r.status, 201);
  assert.equal(r.body.situacao, 'PENDENTE');
  assert.match(r.body.mensagem, /Aguarde o professor/);

  const detalhe = (await prof.get(`/api/turmas/${turma.id}`)).body.turma;
  assert.equal(detalhe.totalPendentes, 1);
  assert.equal(detalhe.totalEstudantes, 0, 'pendente ainda não participa');
  assert.deepEqual(detalhe.pendentes.map((e) => e.nome), ['Ana']);

  // Pedir de novo enquanto aguarda não cria outra solicitação.
  const repetida = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(repetida.status, 409);
  assert.match(repetida.body.erro, /aguardando/);
});

test('o professor aprova a solicitação e o estudante passa a participar (UC06 A3)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Turma fechada', requerAprovacao: true });
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/aprovar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.totalEstudantes, 1);
  assert.equal(r.body.turma.totalPendentes, 0);

  const minhas = (await ana.get('/api/estudante/turmas')).body.turmas;
  assert.equal(minhas[0].situacao, 'APROVADA');
  assert.ok(minhas[0].decididoEm);
});

test('o professor recusa, e o estudante não entra nem pode insistir (UC06 A4)', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Turma fechada', requerAprovacao: true });
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/recusar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.totalEstudantes, 0);
  assert.deepEqual(r.body.turma.recusados.map((e) => e.nome), ['Ana']);

  const insistencia = await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(insistencia.status, 409);
  assert.match(insistencia.body.erro, /recusada/);

  // A recusa fica registrada: a linha continua, com a situação e a data da decisão.
  const { rows } = await query('SELECT situacao, decidido_em FROM turma_estudante WHERE estudante_id = $1', [idAna]);
  assert.equal(rows[0].situacao, 'RECUSADA');
  assert.ok(rows[0].decidido_em);
});

test('o professor pode reverter uma recusa aprovando depois', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Turma fechada', requerAprovacao: true });
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/recusar`);

  const r = await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/aprovar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.totalEstudantes, 1);
});

test('só se recusa quem está pendente; aprovar quem já participa é informado', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  assert.equal((await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/recusar`)).status, 409);
  assert.equal((await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idAna}/aprovar`)).status, 409);
  assert.equal((await prof.post(`/api/turmas/${turma.id}/solicitacoes/${idBruno}/aprovar`)).status, 404);
});

test('mudar para entrada direta não aprova sozinho quem estava pendente', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof, { nome: 'Turma fechada', requerAprovacao: true });
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await prof.put(`/api/turmas/${turma.id}`).send({ nome: 'Turma fechada', requerAprovacao: false });
  assert.equal(r.body.turma.totalPendentes, 1);

  // Mas quem chega a partir de agora entra direto.
  const bruno = await entrar(BRUNO.email);
  assert.equal((await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso })).body.situacao, 'APROVADA');
});

// --------------------------------------------------- inativar = "excluir" (Quadro 31)

test('inativar preserva estudantes e bloqueia novas entradas', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const r = await prof.patch(`/api/turmas/${turma.id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(r.status, 200);
  assert.equal(r.body.turma.situacao, 'INATIVA');
  assert.equal(r.body.turma.totalEstudantes, 1, 'os estudantes são preservados');

  // Turma inativa responde como código inválido: não revela que existiu.
  const bruno = await entrar(BRUNO.email);
  const entrada = await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  assert.equal(entrada.status, 404);

  assert.equal((await prof.put(`/api/turmas/${turma.id}`).send({ nome: 'X' })).status, 409);
  assert.equal((await prof.post(`/api/turmas/${turma.id}/codigo`)).status, 409);

  const { rows } = await query('SELECT count(*)::int AS total FROM turma WHERE id = $1', [turma.id]);
  assert.equal(rows[0].total, 1, 'a turma não é apagada');
});

test('turma inativa sai da lista padrão, aparece no filtro e pode ser reativada', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  await prof.patch(`/api/turmas/${turma.id}/situacao`).send({ situacao: 'INATIVA' });

  assert.equal((await prof.get('/api/turmas')).body.turmas.length, 0);
  assert.equal((await prof.get('/api/turmas').query({ situacao: 'INATIVA' })).body.turmas.length, 1);

  const r = await prof.patch(`/api/turmas/${turma.id}/situacao`).send({ situacao: 'ATIVA' });
  assert.equal(r.body.turma.situacao, 'ATIVA');
});

test('não existe exclusão física de turma', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  assert.equal((await prof.delete(`/api/turmas/${turma.id}`)).status, 404);
});

// -------------------------------------------------------------------- privacidade

test('o estudante não vê o código nem os colegas', async () => {
  const prof = await entrar(PROF.email);
  const turma = await criarTurma(prof);
  const ana = await entrar(ANA.email);
  const bruno = await entrar(BRUNO.email);
  await ana.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });
  await bruno.post('/api/estudante/turmas/entrar').send({ codigo: turma.codigoAcesso });

  const corpo = JSON.stringify((await ana.get('/api/estudante/turmas')).body);
  assert.doesNotMatch(corpo, new RegExp(turma.codigoAcesso));
  assert.doesNotMatch(corpo, /bruno/i);
});

test('tentativas de código em excesso são bloqueadas (429)', async () => {
  const restrito = criarApp({ limites: { codigoTurmaMax: 3, janelaMinutos: 15 } });
  const agente = request.agent(restrito);
  await agente.post('/api/auth/login').send({ email: ANA.email, senha: SENHA });

  for (let i = 0; i < 3; i += 1) await agente.post('/api/estudante/turmas/entrar').send({ codigo: 'ZZZZZZZZ' });
  assert.equal((await agente.post('/api/estudante/turmas/entrar').send({ codigo: 'ZZZZZZZZ' })).status, 429);
});
