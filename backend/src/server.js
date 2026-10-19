// Ponto de entrada: abre a porta HTTP e encerra de forma limpa.
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { criarApp } from './app.js';

const app = criarApp();

const servidor = app.listen(env.porta, () => {
  console.log(`[api] ouvindo na porta ${env.porta} (${env.nodeEnv})`);
});

function encerrar(sinal) {
  console.log(`[api] ${sinal} recebido — encerrando.`);
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
