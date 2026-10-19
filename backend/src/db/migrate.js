// Aplica, em ordem, os arquivos backend/migrations/NNN_descricao.sql ainda não aplicados.
// Cada arquivo roda em uma transação própria e é registrado em schema_migrations.
// Regra: nunca editar uma migração já aplicada — criar uma nova.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const PASTA = fileURLToPath(new URL('../../migrations/', import.meta.url));
const TRAVA = 2026092801; // pg_advisory_lock: impede duas execuções simultâneas

export async function migrar({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [TRAVA]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        versao     TEXT PRIMARY KEY,
        aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT versao FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.versao));
    const arquivos = (await readdir(PASTA)).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();

    let novas = 0;
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      const sql = await readFile(PASTA + arquivo, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (versao) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        novas += 1;
        log(`[migrate] aplicada: ${arquivo}`);
      } catch (erro) {
        await client.query('ROLLBACK');
        // `cause` preserva o erro original do PostgreSQL; sem ele, sobra só a mensagem.
        throw new Error(`Falha ao aplicar ${arquivo}: ${erro.message}`, { cause: erro });
      }
    }
    log(novas ? `[migrate] ${novas} migração(ões) aplicada(s).` : '[migrate] banco já está atualizado.');
    return novas;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [TRAVA]).catch(() => {});
    client.release();
  }
}

// Execução direta: `npm run migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrar()
    .then(() => pool.end())
    .catch(async (erro) => {
      console.error('[migrate] ERRO:', erro.message);
      await pool.end();
      process.exit(1);
    });
}
