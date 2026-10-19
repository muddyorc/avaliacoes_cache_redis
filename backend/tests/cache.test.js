// Cache de leitura da estrutura da prova — camada nova do Projeto N2 (Redis).
//
// Duas famílias de casos aqui, por um motivo prático: **o Redis é opcional**. Os casos de
// degradação rodam sempre, e são os mais importantes — eles provam que o sistema inteiro
// continua funcionando com o Redis fora do ar, que é o estado em que ele estará na
// máquina de qualquer pessoa que clonar o repositório sem subir o servidor. Os casos de
// HIT/MISS precisam de um Redis de verdade e se declaram `skip` quando não há um.
//
// O Redis dos testes é apontado por REDIS_URL_TESTE e usa o banco lógico 9, pela mesma
// disciplina do DATABASE_URL_TESTE: teste não escreve onde o desenvolvimento lê. Mesmo
// assim, cada caso apaga só as chaves que ele próprio criou — nunca um FLUSHDB, que
// limparia o Redis de quem rodasse a suíte apontada para o lugar errado.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createClient } from 'redis';
import { criarApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { query } from '../src/db/pool.js';
import { buscar, disponivel, emPausa, encerrar, esquecerFalhas, guardar } from '../src/servicos/cache.js';
import { chaveDaEstrutura } from '../src/modules/realizacao/realizacao.service.js';
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
const ANA = { nome: 'Ana', email: 'ana@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };

const URL_TESTE = process.env.REDIS_URL_TESTE || 'redis://localhost:6379/9';
// Porta deliberadamente vazia: é assim que se simula "o Redis caiu" sem derrubar nada.
const URL_MORTA = 'redis://127.0.0.1:6399';

const daqui = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const original = { ...env.cache };
let temRedis = false;

// Abre um cliente próprio do teste, para conferir o conteúdo do Redis sem passar pelo
// módulo que está sendo testado — um teste que usa a coisa testada para se verificar não
// prova nada.
async function clienteDoTeste() {
  const cliente = createClient({ url: URL_TESTE, socket: { connectTimeout: 500, reconnectStrategy: false } });
  cliente.on('error', () => {});
  await cliente.connect();
  return cliente;
}

before(async () => {
  await prepararBanco();
  try {
    const cliente = await clienteDoTeste();
    cliente.destroy();
    temRedis = true;
  } catch {
    temRedis = false;
    console.log(`[cache.test] Redis ausente em ${URL_TESTE} — os casos de HIT/MISS serão pulados.`);
  }
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROF);
  await criarUsuario(ANA);
  // Cada caso decide o seu cenário de cache. Voltar ao padrão entre casos evita que uma
  // URL morta sobre de um caso para o outro.
  await encerrar();
  esquecerFalhas();
  Object.assign(env.cache, original);
});

after(async () => {
  Object.assign(env.cache, original);
  await encerrar();
  await encerrarBanco();
});

async function entrar(email) {
  const agente = request.agent(app);
  assert.equal((await agente.post('/api/auth/login').send({ email, senha: SENHA })).status, 200);
  return agente;
}

// Prova com uma objetiva e uma discursiva, publicada e vinculada à turma da Ana.
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
    respostaEsperada: 'Bioma de savana.',
    criteriosCorrecao: 'Citar savana.',
  })).body.questao;

  const avaliacao = (await prof.post('/api/avaliacoes').send({
    titulo: 'Prova de Geografia',
    duracaoMinutos: 60,
    dataInicio: daqui(-1),
    dataFim: daqui(24),
  })).body.avaliacao;
  await vincularTurmaComEstudantes(avaliacao.id, [ANA.email]);
  await prof.put(`/api/avaliacoes/${avaliacao.id}/questoes`).send({
    questoes: [{ questaoId: objetiva.id }, { questaoId: discursiva.id }],
  });
  assert.equal((await prof.post(`/api/avaliacoes/${avaliacao.id}/publicar`)).status, 200);
  return { avaliacao, objetiva, discursiva };
}

// ------------------------------------------------------- degradação (roda sempre)

test('com o Redis fora do ar, a prova funciona do início ao fim', async () => {
  env.cache.ativo = true;
  env.cache.url = URL_MORTA;

  const prof = await entrar(PROF.email);
  const { avaliacao, objetiva } = await prepararProva(prof);
  const ana = await entrar(ANA.email);

  const iniciou = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
  assert.equal(iniciou.status, 200, 'iniciar não pode depender do cache');
  assert.equal(iniciou.body.questoes.length, 2);

  // O caminho quente: retomar e salvar, que é o que a tela faz a cada 10 s.
  const retomou = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
  assert.equal(retomou.status, 200);
  assert.equal(retomou.body.questoes.length, 2);

  const alternativa = retomou.body.questoes.find((q) => q.questaoId === objetiva.id).alternativas[0].id;
  const salvou = await ana
    .put(`/api/estudante/avaliacoes/${avaliacao.id}/respostas`)
    .send({ respostas: [{ questaoId: objetiva.id, alternativaId: alternativa }] });
  assert.equal(salvou.status, 200, 'o salvamento automático não pode depender do cache');

  assert.equal(disponivel(), false, 'não havia Redis para conectar');
});

test('depois de falhar, o cache para de tentar por um tempo', async () => {
  env.cache.ativo = true;
  env.cache.url = URL_MORTA;

  assert.equal(emPausa(), false, 'começa sem pausa');
  assert.equal(await buscar(chaveDaEstrutura(1)), null, 'sem Redis, toda busca é MISS');

  // A pausa é o que impede o cache de virar imposto: sem ela, cada requisição pagaria o
  // tempo de conexão de novo, e a API ficaria mais lenta por causa do atalho.
  assert.equal(emPausa(), true, 'desistiu de tentar depois da falha');
  assert.equal(await guardar(chaveDaEstrutura(1), [{ a: 1 }], 60), false, 'gravar também falha em silêncio');

  esquecerFalhas();
  assert.equal(emPausa(), false);
});

test('com o cache desligado, o Redis nunca é procurado', async () => {
  env.cache.ativo = false;
  env.cache.url = URL_MORTA;

  assert.equal(await buscar(chaveDaEstrutura(7)), null);
  assert.equal(await guardar(chaveDaEstrutura(7), [{ a: 1 }], 60), false);
  // Se tivesse tentado conectar na URL morta, teria falhado e entrado em pausa. Não
  // entrou: a chave desligada corta antes de qualquer rede.
  assert.equal(emPausa(), false);
  assert.equal(disponivel(), false);
});

test('a chave carrega a versão do formato', () => {
  assert.equal(chaveDaEstrutura(42), 'prova:v1:42:estrutura');
});

// ------------------------------------------------ HIT e MISS (exigem Redis no ar)

test('a estrutura congelada entra no cache e o HIT devolve o mesmo conteúdo', async (t) => {
  if (!temRedis) return t.skip(`Redis ausente em ${URL_TESTE}`);
  env.cache.ativo = true;
  env.cache.url = URL_TESTE;

  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const chave = chaveDaEstrutura(avaliacao.id);
  const cliente = await clienteDoTeste();

  try {
    await cliente.del(chave);
    await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);

    // MISS: a primeira retomada depois do COMMIT é quem popula.
    const primeira = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
    assert.equal(primeira.status, 200);
    assert.notEqual(await cliente.get(chave), null, 'a prova congelada precisa ter sido guardada');

    // HIT: mesmo conteúdo, bit a bit. É o que garante que a ida e volta pelo JSON não
    // perde tipo nenhum — `pontuacao` numérica, `congelada` booleana, `origemId` nulo.
    const segunda = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
    assert.deepEqual(segunda.body.questoes, primeira.body.questoes);
    assert.deepEqual(JSON.parse(await cliente.get(chave)), primeira.body.questoes);
  } finally {
    await cliente.del(chave);
    cliente.destroy();
  }
});

test('o que está no cache é o que a prova devolve', async (t) => {
  if (!temRedis) return t.skip(`Redis ausente em ${URL_TESTE}`);
  env.cache.ativo = true;
  env.cache.url = URL_TESTE;

  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const chave = chaveDaEstrutura(avaliacao.id);
  const cliente = await clienteDoTeste();

  try {
    await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
    await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);

    // Uma marca que o banco não tem: se ela aparecer na resposta, a leitura veio do
    // Redis. É a prova direta do HIT, sem cronometrar nada e sem mexer no banco.
    const marcado = [
      {
        questaoId: 99,
        ordem: 1,
        tipo: 'DISCURSIVA',
        enunciado: 'VEIO-DO-CACHE',
        pontuacao: 1,
        congelada: true,
        marcarVarias: false,
        alternativas: [],
      },
    ];
    await cliente.setEx(chave, 60, JSON.stringify(marcado));

    const resposta = await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
    assert.equal(resposta.status, 200);
    assert.deepEqual(resposta.body.questoes, marcado);
  } finally {
    await cliente.del(chave);
    cliente.destroy();
  }
});

test('iniciar a prova não guarda o congelamento antes do COMMIT', async (t) => {
  if (!temRedis) return t.skip(`Redis ausente em ${URL_TESTE}`);
  env.cache.ativo = true;
  env.cache.url = URL_TESTE;

  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const ana = await entrar(ANA.email);
  const chave = chaveDaEstrutura(avaliacao.id);
  const cliente = await clienteDoTeste();

  try {
    await cliente.del(chave);
    // `iniciar` congela e lê a estrutura DENTRO da mesma transação. Guardar ali deixaria
    // no Redis, por horas, uma prova que um ROLLBACK teria apagado do banco.
    const iniciou = await ana.post(`/api/estudante/avaliacoes/${avaliacao.id}/iniciar`);
    assert.equal(iniciou.status, 200);
    assert.equal(iniciou.body.questoes.length, 2, 'a resposta sai completa mesmo sem cachear');
    assert.equal(await cliente.get(chave), null, 'nada de cache antes do COMMIT');

    // Já comitado: a leitura seguinte pode guardar.
    await ana.get(`/api/estudante/avaliacoes/${avaliacao.id}/tentativa`);
    assert.notEqual(await cliente.get(chave), null);
  } finally {
    await cliente.del(chave);
    cliente.destroy();
  }
});

test('prova não congelada não entra no cache', async (t) => {
  if (!temRedis) return t.skip(`Redis ausente em ${URL_TESTE}`);
  env.cache.ativo = true;
  env.cache.url = URL_TESTE;

  const prof = await entrar(PROF.email);
  const { avaliacao } = await prepararProva(prof);
  const cliente = await clienteDoTeste();
  const chave = chaveDaEstrutura(avaliacao.id);

  try {
    await cliente.del(chave);
    // Publicada e sem nenhuma tentativa: a estrutura ainda acompanha o banco de questões
    // e o professor pode editá-la. Guardar isso exigiria invalidar a cada edição de
    // questão — é a precondição que sustenta a chave sem DEL.
    const { rows } = await query(
      'SELECT count(*)::int AS total FROM avaliacao_questao WHERE avaliacao_id = $1 AND congelada_em IS NOT NULL',
      [avaliacao.id],
    );
    assert.equal(rows[0].total, 0, 'o cenário exige prova ainda não congelada');
    assert.equal(await cliente.get(chave), null);
  } finally {
    cliente.destroy();
  }
});
