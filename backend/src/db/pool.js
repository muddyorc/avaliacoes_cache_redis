// Acesso ao PostgreSQL via node-postgres (SQL puro, sem ORM — DT03).
import pg from 'pg';
import { env } from '../config/env.js';

// NUMERIC (OID 1700) chega como string por padrão; notas e pontuações são usadas como número.
pg.types.setTypeParser(1700, (valor) => (valor === null ? null : Number.parseFloat(valor)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
});

// Sem este tratador, uma conexão ociosa encerrada pelo PostgreSQL (reinício, queda de rede)
// emite 'error' e DERRUBA o processo Node. Com ele, a API continua no ar e responde 503
// até o banco voltar; o pool cria novas conexões automaticamente.
pool.on('error', (erro) => {
  console.error('[banco] conexão ociosa perdida:', erro.message);
});

export function query(texto, parametros) {
  return pool.query(texto, parametros);
}

// Executa `fn(client)` dentro de uma transação. Qualquer erro desfaz tudo (ROLLBACK).
export async function transacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}
