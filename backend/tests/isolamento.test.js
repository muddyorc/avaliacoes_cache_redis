// Etapa 1 (DT21) — o banco de testes é separado do banco de desenvolvimento.
//
// Este arquivo é a rede de proteção da estratégia: se alguém apontar DATABASE_URL_TESTE
// para o banco de desenvolvimento, ou rodar os testes sem NODE_ENV=test, a suíte falha
// aqui em vez de apagar os dados que o autor usa para testar o sistema no navegador.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { encerrarBanco, exigirBancoDeTeste } from './ajuda/banco.js';

after(async () => {
  await encerrarBanco();
});

test('os testes rodam com NODE_ENV=test', () => {
  assert.equal(env.nodeEnv, 'test');
});

test('a conexão usa DATABASE_URL_TESTE, e não DATABASE_URL', () => {
  assert.ok(process.env.DATABASE_URL_TESTE, 'DATABASE_URL_TESTE precisa estar definida');
  assert.equal(env.databaseUrl, process.env.DATABASE_URL_TESTE);
  assert.notEqual(env.databaseUrl, process.env.DATABASE_URL);
});

test('o banco conectado tem nome diferente do banco de desenvolvimento', async () => {
  const { rows } = await query('SELECT current_database() AS banco');
  const bancoDeDesenvolvimento = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');

  assert.notEqual(rows[0].banco, bancoDeDesenvolvimento);
  assert.equal(rows[0].banco, new URL(process.env.DATABASE_URL_TESTE).pathname.replace(/^\//, ''));
});

test('a guarda aborta os testes se o isolamento for quebrado', () => {
  const original = process.env.DATABASE_URL;
  try {
    // Simula alguém apontando as duas variáveis para o mesmo banco.
    process.env.DATABASE_URL = env.databaseUrl;
    assert.throws(() => exigirBancoDeTeste(), /apagariam o banco de desenvolvimento/);
  } finally {
    process.env.DATABASE_URL = original;
  }
});
