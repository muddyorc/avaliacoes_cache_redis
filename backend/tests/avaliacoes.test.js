// Etapa 4 — RF03 (criar) e RF04 (gerenciar) avaliações: UC03, UC04, RN01, RN02,
// P-01, P-05, P-06, P-15a, DT14 e Quadro 31.
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
const ESTUDANTE = { nome: 'Est.', email: 'est@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const ADMIN = { nome: 'Adm.', email: 'adm@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };

const HORA = 60 * 60 * 1000;
const daqui = (horas) => new Date(Date.now() + horas * HORA).toISOString();

const AVALIACAO = {
  titulo: 'Prova 1 — Banco de Dados',
  descricao: 'Leia com atenção. Consulta não permitida.',
  duracaoMinutos: 60,
  dataInicio: daqui(1),
  dataFim: daqui(48),
  monitoramentoAtivo: true,
  limiteOcorrencias: null,
};

const OBJETIVA = {
  tipo: 'OBJETIVA',
  enunciado: 'Quanto é 2 + 2?',
  pontuacaoPadrao: 2,
  alternativas: [
    { texto: '4', correta: true },
    { texto: '5', correta: false },
  ],
};

let idEstudante;

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(OUTRO_PROF);
  idEstudante = (await criarUsuario(ESTUDANTE)).id;
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

async function criarAvaliacao(agente, dados = AVALIACAO) {
  const r = await agente.post('/api/avaliacoes').send(dados);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.avaliacao;
}

async function criarQuestao(agente, dados = OBJETIVA) {
  const r = await agente.post('/api/questoes').send(dados);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.questao;
}

async function criarTurma(agente, nome = 'Turma A') {
  const r = await agente.post('/api/turmas').send({ nome });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.turma;
}

// Avaliação com questões e uma turma vinculada, pronta para publicar. Desde a Etapa 5
// a avaliação nasce privada, e privada só publica com turma (P-19).
async function avaliacaoComQuestoes(agente, quantidade = 2) {
  const avaliacao = await criarAvaliacao(agente);
  const questoes = [];
  for (let i = 0; i < quantidade; i += 1) {
    questoes.push(await criarQuestao(agente, { ...OBJETIVA, enunciado: `Questão ${i + 1}` }));
  }
  const turma = await criarTurma(agente);
  assert.equal((await agente.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] })).status, 200);
  const r = await agente
    .put(`/api/avaliacoes/${avaliacao.id}/questoes`)
    .send({ questoes: questoes.map((q) => ({ questaoId: q.id })) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { avaliacao: r.body.avaliacao, questoes, turma };
}

// Simula o início efetivo de uma tentativa (Etapa 6 ainda não existe pela API).
async function iniciarTentativa(avaliacaoId) {
  await query(
    "INSERT INTO tentativa (avaliacao_id, estudante_id, prazo_final) VALUES ($1, $2, now() + interval '30 minutes')",
    [avaliacaoId, idEstudante],
  );
}

// -------------------------------------------------------------------- RN02 / acesso

test('somente o professor gerencia avaliações (RN02)', async () => {
  assert.equal((await request(app).get('/api/avaliacoes')).status, 401);
  for (const perfil of [ESTUDANTE, ADMIN]) {
    const agente = await entrar(perfil.email);
    assert.equal((await agente.get('/api/avaliacoes')).status, 403);
    assert.equal((await agente.post('/api/avaliacoes').send(AVALIACAO)).status, 403);
  }
  assert.equal((await (await entrar(PROF.email)).get('/api/avaliacoes')).status, 200);
});

test('um professor não vê nem altera as avaliações de outro', async () => {
  const dono = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(dono);
  const outro = await entrar(OUTRO_PROF.email);

  assert.equal((await outro.get(`/api/avaliacoes/${avaliacao.id}`)).status, 404);
  assert.equal((await outro.put(`/api/avaliacoes/${avaliacao.id}`).send(AVALIACAO)).status, 404);
  assert.equal((await outro.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 404);
  assert.equal((await outro.post(`/api/avaliacoes/${avaliacao.id}/arquivar`)).status, 404);
  assert.equal((await outro.post(`/api/avaliacoes/${avaliacao.id}/excluir`)).status, 404);
  assert.equal((await outro.post(`/api/avaliacoes/${avaliacao.id}/duplicar`)).status, 404);
  assert.equal((await outro.get('/api/avaliacoes')).body.total, 0);
});

test('não é possível montar avaliação com questões de outro professor', async () => {
  const outro = await entrar(OUTRO_PROF.email);
  const alheia = await criarQuestao(outro);

  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: alheia.id }] });

  assert.equal(r.status, 400);
  assert.ok(r.body.campos.questoes);
});

// ----------------------------------------------------------------- criação (UC03)

test('professor cria avaliação, que nasce em rascunho (UC03)', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);

  assert.equal(avaliacao.status, 'RASCUNHO');
  assert.equal(avaliacao.titulo, AVALIACAO.titulo);
  assert.equal(avaliacao.duracaoMinutos, 60);
  assert.equal(avaliacao.monitoramentoAtivo, true);
  assert.equal(avaliacao.limiteOcorrencias, null);
  assert.equal(avaliacao.resultadosLiberados, false);
  assert.equal(avaliacao.totalQuestoes, 0);
  assert.equal(avaliacao.iniciada, false);
});

test('campos obrigatórios vazios voltam indicados um a um (UC03 A1)', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/avaliacoes').send({ titulo: '  ', descricao: 'x' });

  assert.equal(r.status, 400);
  for (const campo of ['titulo', 'duracaoMinutos', 'dataInicio', 'dataFim']) {
    assert.ok(r.body.campos[campo], `o campo ${campo} deveria vir indicado`);
  }
});

test('regressão: duração vazia aponta o campo pendente, não "maior que zero" (UC03 A1)', async () => {
  const prof = await entrar(PROF.email);
  for (const duracaoMinutos of ['', null, undefined]) {
    const r = await prof.post('/api/avaliacoes').send({ ...AVALIACAO, duracaoMinutos });
    assert.equal(r.status, 400);
    assert.equal(r.body.campos.duracaoMinutos, 'Informe a duração.');
  }
});

test('regressão: os campos opcionais podem simplesmente não vir no corpo', async () => {
  // Encontrado no teste de navegador: omitir `limiteOcorrencias` devolvia 400 com
  // mensagem em inglês. A tela sempre envia o campo, então só outro cliente da API sofria.
  const prof = await entrar(PROF.email);
  const { titulo, duracaoMinutos, dataInicio, dataFim } = AVALIACAO;

  const r = await prof.post('/api/avaliacoes').send({ titulo, duracaoMinutos, dataInicio, dataFim });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.avaliacao.limiteOcorrencias, null);
  assert.equal(r.body.avaliacao.monitoramentoAtivo, true);
  assert.equal(r.body.avaliacao.descricao, null);
});

test('nenhuma mensagem de validação sai em inglês', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/avaliacoes').send({ titulo: 5, duracaoMinutos: 'x', dataInicio: 'ontem', monitoramentoAtivo: 'sim' });

  assert.equal(r.status, 400);
  for (const [campo, mensagem] of Object.entries(r.body.campos)) {
    assert.doesNotMatch(mensagem, /invalid|expected|received|required/i, `${campo}: "${mensagem}"`);
  }
});

test('o período precisa terminar depois de começar (P-05)', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/avaliacoes').send({ ...AVALIACAO, dataInicio: daqui(5), dataFim: daqui(2) });

  assert.equal(r.status, 400);
  assert.ok(r.body.campos.dataFim);
});

test('a duração não pode exceder o período disponível', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/avaliacoes').send({ ...AVALIACAO, dataInicio: daqui(1), dataFim: daqui(2), duracaoMinutos: 90 });

  assert.equal(r.status, 400);
  assert.ok(r.body.campos.duracaoMinutos);
});

test('limite de ocorrências: vazio registra sem bloquear, número precisa ser positivo (P-06)', async () => {
  const prof = await entrar(PROF.email);

  assert.equal((await criarAvaliacao(prof, { ...AVALIACAO, limiteOcorrencias: '' })).limiteOcorrencias, null);
  assert.equal((await criarAvaliacao(prof, { ...AVALIACAO, limiteOcorrencias: 3 })).limiteOcorrencias, 3);

  for (const limite of [0, -2, 1.5, 'abc']) {
    const r = await prof.post('/api/avaliacoes').send({ ...AVALIACAO, limiteOcorrencias: limite });
    assert.equal(r.status, 400, `limite ${limite} deveria ser recusado`);
    assert.ok(r.body.campos.limiteOcorrencias);
  }
});

test('sem monitoramento não há limite de ocorrências (P-06)', async () => {
  const prof = await entrar(PROF.email);
  const r = await prof.post('/api/avaliacoes').send({ ...AVALIACAO, monitoramentoAtivo: false, limiteOcorrencias: 3 });

  assert.equal(r.status, 400);
  assert.match(r.body.campos.limiteOcorrencias, /monitoramento ativo/i);

  const ok = await criarAvaliacao(prof, { ...AVALIACAO, monitoramentoAtivo: false });
  assert.equal(ok.monitoramentoAtivo, false);
});

// A visibilidade dos resultados é decidida na criação (16/10/2026). O que estes testes
// guardam: ela chega inteira no POST, e um PUT que não fala dela não a apaga — era o
// risco de trazer essas colunas para o formulário principal.

test('a visibilidade dos resultados pode ser escolhida já na criação', async () => {
  const prof = await entrar(PROF.email);

  const padrao = await criarAvaliacao(prof);
  assert.deepEqual(padrao.divulgacao, {
    gabarito: false,
    mediaTurma: false,
    distribuicao: false,
    questoesDestaque: false,
  });

  const escolhida = await criarAvaliacao(prof, {
    ...AVALIACAO,
    divulgacao: { gabarito: true, mediaTurma: true },
  });
  assert.deepEqual(escolhida.divulgacao, {
    gabarito: true,
    mediaTurma: true,
    distribuicao: false,
    questoesDestaque: false,
  });
});

test('salvar as informações sem falar da divulgação não desmarca o que já estava escolhido', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof, { ...AVALIACAO, divulgacao: { gabarito: true } });

  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}`).send({ ...AVALIACAO, titulo: 'Outro título' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.avaliacao.titulo, 'Outro título');
  assert.equal(r.body.avaliacao.divulgacao.gabarito, true, 'a marcação sobreviveu ao PUT');

  // E quem fala dela, muda.
  const comDivulgacao = await prof
    .put(`/api/avaliacoes/${avaliacao.id}`)
    .send({ ...AVALIACAO, divulgacao: { distribuicao: true } });
  assert.equal(comDivulgacao.body.avaliacao.divulgacao.gabarito, false);
  assert.equal(comDivulgacao.body.avaliacao.divulgacao.distribuicao, true);
});

// ------------------------------------------------------- questões da avaliação (P-01)

test('professor monta a avaliação com questões do banco, na ordem escolhida', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const q1 = await criarQuestao(prof, { ...OBJETIVA, enunciado: 'Primeira' });
  const q2 = await criarQuestao(prof, { ...OBJETIVA, enunciado: 'Segunda', pontuacaoPadrao: 3 });

  const r = await prof
    .put(`/api/avaliacoes/${avaliacao.id}/questoes`)
    .send({ questoes: [{ questaoId: q2.id, pontuacao: 5 }, { questaoId: q1.id }] });

  assert.equal(r.status, 200);
  const questoes = r.body.avaliacao.questoes;
  assert.deepEqual(questoes.map((q) => [q.ordem, q.enunciado]), [[1, 'Segunda'], [2, 'Primeira']]);
  // Pontuação por avaliação; sem ela, vale a pontuação padrão da questão.
  assert.deepEqual(questoes.map((q) => q.pontuacao), [5, 2]);
  assert.equal(r.body.avaliacao.pontuacaoTotal, 7);
});

test('a avaliação ainda não aplicada não traz gabarito nem alternativas (DT64)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);

  const texto = JSON.stringify((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body);
  assert.doesNotMatch(texto, /correta|alternativas|respostaEsperada|criteriosCorrecao/);
});

test('depois de congelada, a avaliação traz a cópia das alternativas ao professor (P-22)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);
  // Simula a prova aplicada: é o que o sistema faz no primeiro início (migração 004).
  await query(
    `UPDATE avaliacao_questao aq
        SET enunciado = q.enunciado, tipo = q.tipo, congelada_em = now()
       FROM questao q WHERE q.id = aq.questao_id AND aq.avaliacao_id = $1`,
    [avaliacao.id],
  );
  await query(
    `INSERT INTO avaliacao_alternativa (avaliacao_id, questao_id, origem_id, ordem, texto, correta)
     SELECT aq.avaliacao_id, aq.questao_id, al.id, al.ordem, al.texto, al.correta
       FROM avaliacao_questao aq JOIN alternativa al ON al.questao_id = aq.questao_id
      WHERE aq.avaliacao_id = $1`,
    [avaliacao.id],
  );

  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  const primeira = detalhe.questoes.find((q) => q.questaoId === questoes[0].id);
  assert.equal(primeira.congelada, true);
  assert.ok(primeira.alternativas.length > 0, 'a cópia da prova acompanha o detalhe');
  assert.ok(
    primeira.alternativas.some((a) => a.correta),
    'o professor dono vê qual era a correta na prova que aplicou',
  );
});

test('reordenar, remover e ajustar pontuação em uma só operação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof, 3);

  const r = await prof
    .put(`/api/avaliacoes/${avaliacao.id}/questoes`)
    .send({ questoes: [{ questaoId: questoes[2].id, pontuacao: 1.5 }, { questaoId: questoes[0].id }] });

  assert.equal(r.status, 200);
  assert.deepEqual(r.body.avaliacao.questoes.map((q) => q.enunciado), ['Questão 3', 'Questão 1']);
  assert.equal(r.body.avaliacao.pontuacaoTotal, 3.5);
});

test('a mesma questão não entra duas vezes', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const q = await criarQuestao(prof);

  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: q.id }, { questaoId: q.id }] });
  assert.equal(r.status, 400);
});

test('a mesma questão pode ser reutilizada em várias avaliações (P-01)', async () => {
  const prof = await entrar(PROF.email);
  const q = await criarQuestao(prof);
  for (let i = 0; i < 2; i += 1) {
    const a = await criarAvaliacao(prof, { ...AVALIACAO, titulo: `Prova ${i}` });
    assert.equal((await prof.put(`/api/avaliacoes/${a.id}/questoes`).send({ questoes: [{ questaoId: q.id }] })).status, 200);
  }
  const detalhe = await prof.get(`/api/questoes/${q.id}`);
  assert.equal(detalhe.body.questao.uso.avaliacoesVinculadas, 2);
});

test('questão inativa não pode ser adicionada', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const q = await criarQuestao(prof);
  await prof.patch(`/api/questoes/${q.id}/situacao`).send({ situacao: 'INATIVA' });

  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: q.id }] });
  assert.equal(r.status, 400);
  assert.match(r.body.erro, /inativas/i);
});

// ------------------------------------------------------------------ publicar (RN01)

test('avaliação sem questões não pode ser publicada (RN01)', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);

  assert.equal(avaliacao.acoes.podePublicar, false);
  assert.ok(avaliacao.pendenciasPublicacao.some((p) => /ao menos uma questão/.test(p)));

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /ao menos uma questão/i);
});

test('avaliação com questões é publicada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);

  assert.equal(avaliacao.acoes.podePublicar, true);
  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal(r.status, 200);
  assert.equal(r.body.avaliacao.status, 'PUBLICADA');
});

test('não publica com questão que foi inativada depois de adicionada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);
  // Em rascunho a questão pode ser inativada (UC05 A1 protege só publicadas).
  assert.equal((await prof.patch(`/api/questoes/${questoes[0].id}/situacao`).send({ situacao: 'INATIVA' })).status, 200);

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /inativa/i);
});

test('não publica avaliação cujo período já terminou', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await query("UPDATE avaliacao SET data_inicio = now() - interval '3 days', data_fim = now() - interval '1 day' WHERE id = $1", [avaliacao.id]);

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /período/i);
});

test('publicar duas vezes é recusado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 409);
});

test('publicar ativa a proteção de UC05 A1 sobre as questões', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);

  const r = await prof.patch(`/api/questoes/${questoes[0].id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /avaliação publicada/i);
});

// ------------------------------------------------ edição antes do início (P-15a)

test('rascunho e publicada sem tentativa podem ser editadas (P-15a)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);

  const r1 = await prof.put(`/api/avaliacoes/${avaliacao.id}`).send({ ...AVALIACAO, titulo: 'Novo título' });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.avaliacao.titulo, 'Novo título');

  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  const r2 = await prof.put(`/api/avaliacoes/${avaliacao.id}`).send({ ...AVALIACAO, duracaoMinutos: 90 });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.avaliacao.duracaoMinutos, 90);
  assert.equal(r2.body.avaliacao.status, 'PUBLICADA');
});

test('avaliação publicada não pode perder todas as questões (RN01 continua valendo)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);

  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [] });
  assert.equal(r.status, 409);

  // A operação foi desfeita por inteiro: as questões continuam lá.
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.totalQuestoes, 2);
});

test('avaliação publicada não pode ter o término movido para o passado', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);

  const r = await prof
    .put(`/api/avaliacoes/${avaliacao.id}`)
    .send({ ...AVALIACAO, dataInicio: daqui(-48), dataFim: daqui(-24), duracaoMinutos: 30 });
  assert.equal(r.status, 409);
});

// ---------------------------------------------- bloqueio após o início (UC04 A1, P-15a)

test('depois da primeira tentativa, nenhuma alteração estrutural é aceita (UC04 A1)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.equal(detalhe.iniciada, true);
  assert.equal(detalhe.acoes.podeEditar, false);
  assert.equal(detalhe.acoes.podeExcluir, false);

  // P-15a inclui título e descrição — diferente da proposta original de P-15.
  const tentativas = [
    ['título', { ...AVALIACAO, titulo: 'Outro título' }],
    ['descrição', { ...AVALIACAO, descricao: 'Outras instruções' }],
    ['duração', { ...AVALIACAO, duracaoMinutos: 30 }],
    ['período', { ...AVALIACAO, dataFim: daqui(72) }],
    ['monitoramento', { ...AVALIACAO, monitoramentoAtivo: false }],
    ['limite de ocorrências', { ...AVALIACAO, limiteOcorrencias: 2 }],
  ];
  for (const [nome, corpo] of tentativas) {
    const r = await prof.put(`/api/avaliacoes/${avaliacao.id}`).send(corpo);
    assert.equal(r.status, 409, `alterar ${nome} deveria ser recusado`);
    assert.match(r.body.erro, /já foi iniciada/i);
  }

  const q = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: questoes[0].id }] });
  assert.equal(q.status, 409, 'alterar as questões deveria ser recusado');

  // Nada mudou no banco.
  const { rows } = await query('SELECT titulo, duracao_minutos FROM avaliacao WHERE id = $1', [avaliacao.id]);
  assert.equal(rows[0].titulo, AVALIACAO.titulo);
  assert.equal(rows[0].duracao_minutos, 60);
  const { rows: vinculos } = await query('SELECT count(*)::int AS total FROM avaliacao_questao WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(vinculos[0].total, 2);
});

test('avaliação iniciada continua podendo ser consultada, arquivada e duplicada (P-15a)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).status, 200);

  const copia = await prof.post(`/api/avaliacoes/${avaliacao.id}/duplicar`);
  assert.equal(copia.status, 201);

  const arquivada = await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`);
  assert.equal(arquivada.status, 200);
  assert.equal(arquivada.body.avaliacao.status, 'ARQUIVADA');
});

test('avaliação iniciada não pode ser excluída', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/excluir`);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /arquive/i);
});

// ------------------------------------------------------------------------- duplicar

test('duplicar cria avaliação nova, independente e em rascunho', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: avaliacao.questoes.map((q, i) => ({ questaoId: q.questaoId, pontuacao: i + 1.5 })),
  });
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  const copia = (await prof.post(`/api/avaliacoes/${avaliacao.id}/duplicar`)).body.avaliacao;
  assert.notEqual(copia.id, avaliacao.id);
  assert.equal(copia.status, 'RASCUNHO');
  assert.equal(copia.titulo, `${AVALIACAO.titulo} (cópia)`);
  assert.equal(copia.iniciada, false);
  assert.equal(copia.totalTentativas, 0);
  assert.equal(copia.resultadosLiberados, false);
  assert.deepEqual(copia.questoes.map((q) => [q.ordem, q.pontuacao]), [[1, 1.5], [2, 2.5]]);

  // A cópia é editável, e mexer nela não afeta a original.
  const edicao = await prof.put(`/api/avaliacoes/${copia.id}`).send({ ...AVALIACAO, titulo: 'Prova 1 — reaplicação' });
  assert.equal(edicao.status, 200);
  const original = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.equal(original.titulo, AVALIACAO.titulo);
  assert.equal(original.status, 'PUBLICADA');
});

// ------------------------------------------------------------------------- arquivar

test('arquivar tira a avaliação das ativas e congela a edição', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`);

  assert.equal((await prof.get('/api/avaliacoes')).body.total, 0);
  assert.equal((await prof.get('/api/avaliacoes').query({ situacao: 'ARQUIVADA' })).body.total, 1);

  const r = await prof.put(`/api/avaliacoes/${avaliacao.id}`).send(AVALIACAO);
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /arquivada/i);
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`)).status, 409);
});

// ------------------------------------------------------ excluir = exclusão lógica (DT14)

test('excluir é lógico: some das listas, mas a linha continua no banco', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/excluir`);
  assert.equal(r.status, 200);

  assert.equal((await prof.get('/api/avaliacoes')).body.total, 0);
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).status, 404);

  const { rows } = await query('SELECT status FROM avaliacao WHERE id = $1', [avaliacao.id]);
  assert.equal(rows.length, 1, 'a avaliação não pode ser apagada fisicamente');
  assert.equal(rows[0].status, 'EXCLUIDA');
});

test('excluir uma publicada sem tentativa libera as questões para inativação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/excluir`);

  const r = await prof.patch(`/api/questoes/${questoes[0].id}/situacao`).send({ situacao: 'INATIVA' });
  assert.equal(r.status, 200);
});

test('não existe exclusão física de avaliação', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);

  assert.equal((await prof.delete(`/api/avaliacoes/${avaliacao.id}`)).status, 404);
  const { rows } = await query('SELECT count(*)::int AS total FROM avaliacao WHERE id = $1', [avaliacao.id]);
  assert.equal(rows[0].total, 1);
});

// ------------------------------------------------------------------------- listagem

test('a listagem separa ativas e arquivadas, busca por título e pagina', async () => {
  const prof = await entrar(PROF.email);
  for (let i = 0; i < 3; i += 1) await criarAvaliacao(prof, { ...AVALIACAO, titulo: `Prova de Redes ${i}` });
  const arquivar = await criarAvaliacao(prof, { ...AVALIACAO, titulo: 'Prova antiga' });
  await prof.post(`/api/avaliacoes/${arquivar.id}/arquivar`);

  assert.equal((await prof.get('/api/avaliacoes')).body.total, 3);
  assert.equal((await prof.get('/api/avaliacoes').query({ situacao: 'ARQUIVADA' })).body.total, 1);
  assert.equal((await prof.get('/api/avaliacoes').query({ busca: 'REDES 1' })).body.total, 1);

  const pagina = await prof.get('/api/avaliacoes').query({ tamanho: 2 });
  assert.equal(pagina.body.avaliacoes.length, 2);
  assert.equal(pagina.body.paginas, 2);
});

test('id inexistente ou inválido não quebra a API', async () => {
  const prof = await entrar(PROF.email);
  assert.equal((await prof.get('/api/avaliacoes/999999')).status, 404);
  assert.equal((await prof.get('/api/avaliacoes/abc')).status, 400);
});

// ----------------------------------------- toda avaliação é privada (reversão do P-19)
//
// A avaliação PÚBLICA, que ficava aberta a qualquer estudante cadastrado sem turma, foi
// removida a pedido do orientador em 13/10/2026. Os testes que exercitavam a escolha
// entre pública e privada saíram junto; no lugar deles fica a garantia de que o estado
// antigo não volta — e no nível do banco, não só no código.

test('o campo visibilidade não aparece mais na resposta da API', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  assert.equal(avaliacao.visibilidade, undefined);
  // Enviar o campo antigo não ressuscita o comportamento: ele é simplesmente ignorado.
  const outra = await criarAvaliacao(prof, { ...AVALIACAO, visibilidade: 'PUBLICA' });
  assert.equal(outra.visibilidade, undefined);
});

test('a migração 010 faz o banco recusar avaliação pública', async () => {
  const prof = await entrar(PROF.email);
  // Precisa existir uma linha: `UPDATE` sem linhas não chega a violar o CHECK, e o teste
  // passaria sem provar nada.
  await criarAvaliacao(prof);

  const { rows } = await query(
    "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'avaliacao' AND column_name = 'visibilidade'",
  );
  assert.equal(rows.length, 1, 'a coluna continua existindo: ela foi neutralizada, não apagada');
  assert.match(rows[0].column_default, /PRIVADA/);
  assert.equal(rows[0].is_nullable, 'NO');

  // A trava que importa: nem por SQL direto dá para criar uma avaliação pública.
  await assert.rejects(
    () => query("UPDATE avaliacao SET visibilidade = 'PUBLICA'"),
    /avaliacao_visibilidade_check/,
    'o CHECK da migração 010 deveria recusar o valor antigo',
  );
});

// --------------------------------------------------------- vínculo com turmas (RF07, UC07)

async function avaliacaoSemTurma(agente, dados = AVALIACAO) {
  const avaliacao = await criarAvaliacao(agente, dados);
  const q = await criarQuestao(agente);
  await agente.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: q.id }] });
  return avaliacao;
}

// UMA turma por avaliação, desde 15/10/2026 (migração 012). A prova passou a morar na
// turma, e quem quiser a mesma avaliação em outra turma duplica — o reaproveitamento
// vive no banco de questões, não na prova montada.
test('o professor vincula a avaliação a UMA turma (UC07)', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  const a = await criarTurma(prof, 'Turma A');

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [a.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.avaliacao.turmas.map((t) => t.nome), ['Turma A']);

  // A turma passa a mostrar a avaliação.
  const turma = (await prof.get(`/api/turmas/${a.id}`)).body.turma;
  assert.deepEqual(turma.avaliacoes.map((x) => x.titulo), [AVALIACAO.titulo]);
});

test('mandar duas turmas de uma vez é recusado, e nenhuma é vinculada', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  const a = await criarTurma(prof, 'Turma A');
  const b = await criarTurma(prof, 'Turma B');

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [a.id, b.id] });
  assert.equal(r.status, 400, 'recusa em vez de vincular a primeira e ignorar a segunda em silêncio');
  assert.match(r.body.erro, /pertence a uma turma/i);

  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.totalTurmas, 0);
});

test('nenhuma turma selecionada é recusado (UC07 A1)', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.campos.turmaIds, /pelo menos uma turma/);
});

test('a mesma turma é informada; outra turma TROCA (UC07 A2)', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  const a = await criarTurma(prof, 'Turma A');
  const b = await criarTurma(prof, 'Turma B');
  await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [a.id] });

  const repetida = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [a.id] });
  assert.equal(repetida.status, 409);
  assert.match(repetida.body.erro, /já está disponibilizada para a turma Turma A/);

  // Mandar OUTRA turma troca, em vez de recusar. Antes era preciso retirar e vincular de
  // novo, e entre os dois passos a prova ficava sem turma — publicada, inválida nesse
  // intervalo. E "retirar" deixou de existir: sem turma, a prova some da interface.
  const outra = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [b.id] });
  assert.equal(outra.status, 200, JSON.stringify(outra.body));
  assert.deepEqual(outra.body.avaliacao.turmas.map((t) => t.nome), ['Turma B']);

  const { rows } = await query('SELECT count(*)::int AS total FROM avaliacao_turma WHERE avaliacao_id = $1', [avaliacao.id]);
  assert.equal(rows[0].total, 1, 'continua uma turma, e só uma — a troca não acumula vínculo');
});

test('depois de iniciada, a turma não pode mais ser trocada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  const outra = await criarTurma(prof, 'Turma nova');
  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [outra.id] });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /duplique/i, 'a mensagem aponta o caminho que resta');

  // As provas feitas pertencem à turma em que foram feitas (DT41).
  const depois = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.equal(depois.turmas[0].id, turma.id);
});

test('só se vincula a turmas próprias e ativas', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  const outro = await entrar(OUTRO_PROF.email);
  const alheia = await criarTurma(outro, 'Turma do outro');
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [alheia.id] })).status, 400);

  const inativa = await criarTurma(prof, 'Antiga');
  await prof.patch(`/api/turmas/${inativa.id}/situacao`).send({ situacao: 'INATIVA' });
  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [inativa.id] });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /inativa/);
});

test('avaliação arquivada não recebe novas turmas', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`);
  const turma = await criarTurma(prof);
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] })).status, 409);
});

test('depois do início, a turma não pode mais ser trocada (DT41)', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  // Com uma turma por avaliação, acrescentar outra deixou de existir: a prova iniciada
  // tem a turma dela e pronto. Duplicar é o caminho para aplicar em outro público.
  const outra = await criarTurma(prof, 'Turma esquecida');
  const acrescimo = await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [outra.id] });
  assert.equal(acrescimo.status, 409);
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao.totalTurmas, 1);
});

// A cópia nascia SEM turma, com o argumento de que seria para outro público. Isso valia
// enquanto havia uma listagem de avaliações onde encontrá-la; hoje a prova só aparece
// dentro da turma, e uma cópia sem turma some da interface assim que o professor sai da
// tela — aconteceu de verdade, duas vezes, antes desta correção.
test('a cópia herda a turma da original, para não nascer invisível', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, turma } = await avaliacaoComQuestoes(prof);
  const copia = (await prof.post(`/api/avaliacoes/${avaliacao.id}/duplicar`)).body.avaliacao;

  assert.equal(copia.totalTurmas, 1);
  assert.equal(copia.turmas[0].id, turma.id);
  assert.equal(copia.status, 'RASCUNHO', 'a cópia nasce em rascunho, e não publicada junto');

  // E aparece na turma, ao lado da original: é isso que a torna encontrável.
  const daTurma = (await prof.get(`/api/turmas/${turma.id}`)).body.turma;
  assert.ok(daTurma.avaliacoes.some((a) => a.id === copia.id));
});

test('a cópia vem limpa: sem tentativas, sem congelamento e com as questões de hoje', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoComQuestoes(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  // Duplicar vale mesmo depois de aplicada — é justamente o caminho para reaproveitar
  // uma prova que não pode mais ser editada.
  const copia = (await prof.post(`/api/avaliacoes/${avaliacao.id}/duplicar`)).body.avaliacao;
  assert.equal(copia.status, 'RASCUNHO');
  assert.equal(copia.totalTentativas, 0, 'as provas feitas ficam com a original');
  assert.equal(copia.iniciada, false, 'a cópia pode ser editada');

  const { rows } = await query(
    'SELECT count(*) FILTER (WHERE congelada_em IS NOT NULL)::int AS congeladas FROM avaliacao_questao WHERE avaliacao_id = $1',
    [copia.id],
  );
  assert.equal(rows[0].congeladas, 0, 'a cópia aponta para as questões do banco, não para a cópia congelada');
});

// ----------------------------------------------------- P-19: privada exige turma

test('P-19: privada sem turma não publica; com turma publica', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await avaliacaoSemTurma(prof);

  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.ok(detalhe.pendenciasPublicacao.some((p) => /vincule ao menos uma turma/i.test(p)));
  const recusada = await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  assert.equal(recusada.status, 409);
  assert.match(recusada.body.erro, /vincule ao menos uma turma/i);

  const turma = await criarTurma(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
});


// ------------------------------- editar questão pela prova, e o banco de questões

// A regra que estes testes guardam: o banco existe para ser REUSADO, e outras provas
// podem estar usando a mesma questão agora. Editar pela tela de uma prova não pode mudar
// o que as outras aplicam — então a prova ganha uma cópia, e o banco fica como estava.

test('questão criada na prova não vai para o banco, e pode ser promovida depois', async () => {
  const prof = await entrar(PROF.email);

  const fora = (await prof.post('/api/questoes').send({ ...OBJETIVA, noBanco: false })).body.questao;
  assert.equal(fora.uso.noBanco, false);
  assert.equal((await prof.get('/api/questoes')).body.questoes.length, 0, 'não aparece no banco');

  const r = await prof.post(`/api/questoes/${fora.id}/promover`);
  assert.equal(r.status, 200);
  assert.equal(r.body.questao.uso.noBanco, true);
  assert.equal((await prof.get('/api/questoes')).body.questoes.length, 1, 'agora aparece');

  // Promover de novo é informado, e não tratado como erro do professor.
  assert.equal((await prof.post(`/api/questoes/${fora.id}/promover`)).status, 409);
});

test('editar questão exclusiva da prova altera a própria, sem criar cópia', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const questao = (await prof.post('/api/questoes').send({ ...OBJETIVA, noBanco: false })).body.questao;
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: questao.id }] });

  const r = await prof
    .put(`/api/avaliacoes/${avaliacao.id}/questoes/${questao.id}`)
    .send({ ...OBJETIVA, enunciado: 'Enunciado corrigido' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const [naProva] = r.body.avaliacao.questoes;
  assert.equal(naProva.questaoId, questao.id, 'continua sendo a MESMA questão');
  assert.equal(naProva.enunciado, 'Enunciado corrigido');

  // Nenhuma questão nova apareceu.
  const { rows } = await query('SELECT count(*)::int AS total FROM questao');
  assert.equal(rows[0].total, 1);
});

test('editar questão do banco pela prova cria uma cópia e NÃO altera o banco', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const doBanco = await criarQuestao(prof, { ...OBJETIVA, enunciado: 'Enunciado original' });
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({ questoes: [{ questaoId: doBanco.id }] });

  // Uma segunda prova usa a MESMA questão: é ela que não pode mudar junto.
  const outra = await criarAvaliacao(prof, { ...AVALIACAO, titulo: 'Outra prova' });
  await prof.put(`/api/avaliacoes/${outra.id}/questoes`).send({ questoes: [{ questaoId: doBanco.id }] });

  const r = await prof
    .put(`/api/avaliacoes/${avaliacao.id}/questoes/${doBanco.id}`)
    .send({ ...OBJETIVA, enunciado: 'Enunciado só desta prova' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const [naProva] = r.body.avaliacao.questoes;
  assert.notEqual(naProva.questaoId, doBanco.id, 'a prova passou a apontar para outra questão');
  assert.equal(naProva.enunciado, 'Enunciado só desta prova');

  // O banco não mudou...
  const original = (await prof.get(`/api/questoes/${doBanco.id}`)).body.questao;
  assert.equal(original.enunciado, 'Enunciado original');

  // ...e a outra prova continua com a questão do banco.
  const intacta = (await prof.get(`/api/avaliacoes/${outra.id}`)).body.avaliacao;
  assert.equal(intacta.questoes[0].questaoId, doBanco.id);
  assert.equal(intacta.questoes[0].enunciado, 'Enunciado original');

  // A cópia nasce fora do banco, e pode ser promovida como qualquer outra.
  const copia = (await prof.get(`/api/questoes/${naProva.questaoId}`)).body.questao;
  assert.equal(copia.uso.noBanco, false);
  assert.equal((await prof.get('/api/questoes')).body.questoes.length, 1, 'só a original está no banco');
});

test('editar questão pela prova é do professor dono, e só antes de aplicar', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, questoes } = await avaliacaoComQuestoes(prof);

  const outro = await entrar(OUTRO_PROF.email);
  const alheia = await outro.put(`/api/avaliacoes/${avaliacao.id}/questoes/${questoes[0].id}`).send(OBJETIVA);
  assert.equal(alheia.status, 404);

  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);

  const depois = await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes/${questoes[0].id}`).send(OBJETIVA);
  assert.equal(depois.status, 409, 'prova aplicada não tem questão alterada');
});

// ------------------------------------------------------ modo de teste do professor (P-20)

async function avaliacaoMista(agente) {
  const avaliacao = await criarAvaliacao(agente);
  const objetiva = await criarQuestao(agente, {
    tipo: 'OBJETIVA',
    enunciado: 'Capital do Brasil?',
    pontuacaoPadrao: 2,
    alternativas: [
      { texto: 'Rio de Janeiro', correta: false },
      { texto: 'Brasília', correta: true },
    ],
  });
  const objetiva2 = await criarQuestao(agente, { ...OBJETIVA, enunciado: '2 + 2?', pontuacaoPadrao: 1 });
  const discursiva = await criarQuestao(agente, {
    tipo: 'DISCURSIVA',
    enunciado: 'Explique a fotossíntese.',
    pontuacaoPadrao: 3,
    respostaEsperada: 'Conversão de luz em energia química.',
    criteriosCorrecao: 'Citar luz e clorofila.',
  });
  await agente.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: objetiva.id }, { questaoId: objetiva2.id }, { questaoId: discursiva.id }],
  });
  const turma = await criarTurma(agente);
  await agente.post(`/api/avaliacoes/${avaliacao.id}/turmas`).send({ turmaIds: [turma.id] });
  return { avaliacao, objetiva, objetiva2, discursiva };
}

test('o professor abre a própria prova como o estudante a veria, sem gabarito', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoMista(prof);

  const r = await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`);
  assert.equal(r.status, 200);
  assert.equal(r.body.avaliacao.questoes.length, 3);
  assert.equal(r.body.avaliacao.questoes[0].alternativas.length, 2);
  // Nem a alternativa correta nem a resposta esperada saem antes da entrega.
  assert.doesNotMatch(JSON.stringify(r.body), /correta|respostaEsperada|criterios|Conversão de luz/i);
});

test('o teste é corrigido no servidor: objetiva certa pontua, errada e em branco valem 0', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, objetiva2, discursiva } = await avaliacaoMista(prof);
  const alts = (await prof.get(`/api/questoes/${objetiva.id}`)).body.questao.alternativas;
  const certa = alts.find((a) => a.correta).id;

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({
    respostas: [
      { questaoId: objetiva.id, alternativaId: certa },
      // objetiva2 fica em branco (P-12)
      { questaoId: discursiva.id, texto: 'Plantas usam luz.' },
    ],
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [q1, q2, q3] = r.body.itens;
  assert.equal(q1.acertou, true);
  assert.equal(q1.pontosObtidos, 2);
  assert.equal(q2.questaoId, objetiva2.id);
  assert.equal(q2.respondida, false);
  assert.equal(q2.pontosObtidos, 0);
  // Discursiva: sem nota automática, com a referência para o professor comparar.
  assert.equal(q3.pontosObtidos, null);
  assert.equal(q3.respostaEsperada, 'Conversão de luz em energia química.');
  assert.deepEqual(r.body.resumo, { pontosObjetivas: 2, totalObjetivas: 3, totalDiscursivas: 3, pontuacaoTotal: 6 });
});

test('objetiva errada no teste mostra qual era a correta', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await avaliacaoMista(prof);
  const alts = (await prof.get(`/api/questoes/${objetiva.id}`)).body.questao.alternativas;
  const errada = alts.find((a) => !a.correta).id;

  const r = await prof.post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: errada }],
  });
  assert.equal(r.body.itens[0].acertou, false);
  assert.equal(r.body.itens[0].alternativaCorreta, alts.find((a) => a.correta).id);
});

test('o teste do professor não grava nada e não trava a avaliação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await avaliacaoMista(prof);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);

  await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`);
  await prof.post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({ respostas: [{ questaoId: objetiva.id, alternativaId: null }] });

  const { rows } = await query(
    `SELECT (SELECT count(*)::int FROM tentativa) AS tentativas, (SELECT count(*)::int FROM resposta) AS respostas`,
  );
  assert.deepEqual(rows[0], { tentativas: 0, respostas: 0 });

  const detalhe = (await prof.get(`/api/avaliacoes/${avaliacao.id}`)).body.avaliacao;
  assert.equal(detalhe.iniciada, false);
  assert.equal(detalhe.acoes.podeEditar, true);
  assert.equal((await prof.put(`/api/avaliacoes/${avaliacao.id}`).send({ ...AVALIACAO, titulo: 'Ainda editável' })).status, 200);
  // A questão também continua editável: o teste não conta como resposta (P-16).
  assert.equal((await prof.get(`/api/questoes/${objetiva.id}`)).body.questao.uso.podeEditar, true);
});

test('o teste funciona em rascunho, em arquivada e em avaliação já iniciada', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoMista(prof);
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`)).status, 200);

  await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`);
  await iniciarTentativa(avaliacao.id);
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`)).status, 200);

  await prof.post(`/api/avaliacoes/${avaliacao.id}/arquivar`);
  assert.equal((await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`)).status, 200);
});

test('sem questões não há o que testar', async () => {
  const prof = await entrar(PROF.email);
  const avaliacao = await criarAvaliacao(prof);
  const r = await prof.get(`/api/avaliacoes/${avaliacao.id}/teste`);
  assert.equal(r.status, 409);
});

test('respostas que não pertencem à prova são recusadas', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva, objetiva2 } = await avaliacaoMista(prof);
  const altsDeOutra = (await prof.get(`/api/questoes/${objetiva2.id}`)).body.questao.alternativas;
  const fora = await criarQuestao(prof, { ...OBJETIVA, enunciado: 'Fora da prova' });

  const alternativaTrocada = await prof.post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({
    respostas: [{ questaoId: objetiva.id, alternativaId: altsDeOutra[0].id }],
  });
  assert.equal(alternativaTrocada.status, 400);

  const questaoFora = await prof.post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({
    respostas: [{ questaoId: fora.id, alternativaId: null }],
  });
  assert.equal(questaoFora.status, 400);
});

test('só o dono faz o teste da avaliação', async () => {
  const prof = await entrar(PROF.email);
  const { avaliacao } = await avaliacaoMista(prof);

  assert.equal((await (await entrar(OUTRO_PROF.email)).get(`/api/avaliacoes/${avaliacao.id}/teste`)).status, 404);
  assert.equal((await (await entrar(ESTUDANTE.email)).get(`/api/avaliacoes/${avaliacao.id}/teste`)).status, 403);
  assert.equal(
    (await (await entrar(ESTUDANTE.email)).post(`/api/avaliacoes/${avaliacao.id}/teste/correcao`).send({ respostas: [] })).status,
    403,
  );
});
