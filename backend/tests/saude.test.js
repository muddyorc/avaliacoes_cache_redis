// Etapa 0 — comunicação API → PostgreSQL e formato padrão de erros.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { criarApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrar } from '../src/db/migrate.js';

const app = criarApp();

before(async () => {
  await migrar({ silencioso: true });
});

after(async () => {
  await pool.end();
});

test('GET /api/saude confirma API online e banco conectado', async () => {
  const res = await request(app).get('/api/saude');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.api.online, true);
  assert.equal(res.body.banco.conectado, true);
});

// A rota é pública (é o health check do Render), então versão do banco e migrações
// deixaram de sair nela. O que não pode é a resposta voltar a crescer sem querer: este
// teste falha se alguém acrescentar campo técnico à resposta pública.
test('GET /api/saude não expõe versão do banco nem migrações', async () => {
  const res = await request(app).get('/api/saude');
  assert.deepEqual(Object.keys(res.body.banco), ['conectado']);
  const corpo = JSON.stringify(res.body);
  assert.ok(!/PostgreSQL/i.test(corpo), 'a resposta pública não deve citar o banco usado');
  assert.ok(!/migra/i.test(corpo), 'a resposta pública não deve citar migrações');
});

// A verificação continua existindo — só não passa mais pela resposta pública. Perguntar
// direto ao banco é inclusive mais honesto: testa o ambiente, não o que a API conta dele.
test('o ambiente tem PostgreSQL 16+ e as migrações aplicadas', async () => {
  const { rows } = await pool.query(`
    SELECT current_setting('server_version') AS versao,
           (SELECT count(*)::int FROM schema_migrations) AS migracoes,
           (SELECT max(versao) FROM schema_migrations) AS ultima
  `);
  // A versão exata depende do PostgreSQL instalado na máquina (o projeto é homologado
  // a partir do 16). Prender o teste a "16" quebraria em qualquer instalação mais nova
  // sem indicar defeito algum no sistema — DT22.
  const versaoMaior = Number(String(rows[0].versao).match(/^(\d+)/)[1]);
  assert.ok(versaoMaior >= 16, `PostgreSQL 16 ou superior é exigido (encontrado ${versaoMaior})`);
  assert.ok(rows[0].migracoes >= 1);
  assert.ok(rows[0].ultima >= '001_schema_inicial.sql');
});

test('rota inexistente da API devolve 404 no formato padrão', async () => {
  const res = await request(app).get('/api/nao-existe');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { erro: 'Recurso não encontrado.' });
});

test('JSON malformado devolve 400 com mensagem legível', async () => {
  const res = await request(app)
    .post('/api/saude')
    .set('Content-Type', 'application/json')
    .send('{"quebrado":');
  assert.equal(res.status, 400);
  assert.equal(res.body.erro, 'O corpo da requisição não é um JSON válido.');
});

test('regressão: conexão ociosa perdida no pool não derruba a API', async () => {
  // Antes da correção, este evento sem tratador encerrava o processo Node.
  assert.ok(pool.listenerCount('error') >= 1);
  assert.doesNotThrow(() => pool.emit('error', new Error('simulação: terminating connection')));
  const res = await request(app).get('/api/saude');
  assert.equal(res.status, 200);
});

test('resposta não expõe o cabeçalho X-Powered-By', async () => {
  const res = await request(app).get('/api/saude');
  assert.equal(res.headers['x-powered-by'], undefined);
});
