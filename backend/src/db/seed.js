// Cria o administrador inicial caso ainda não exista nenhum administrador.
// Idempotente: pode ser executado a cada inicialização sem duplicar dados.
// Professores não se autocadastram (P-18); o primeiro acesso administrativo nasce aqui.
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { env, emProducao } from '../config/env.js';
import { pool } from './pool.js';

const CUSTO_BCRYPT = 10;

export async function semear({ silencioso = false } = {}) {
  const log = silencioso ? () => {} : console.log;

  const { rows } = await pool.query(
    "SELECT count(*)::int AS total FROM usuario WHERE perfil = 'ADMINISTRADOR'",
  );
  if (rows[0].total > 0) {
    log('[seed] administrador já existe — nada a fazer.');
    return false;
  }

  const { nome, email, senha } = env.admin;
  if (!email || !senha) {
    throw new Error('ADMIN_EMAIL e ADMIN_SENHA devem estar definidos para criar o administrador inicial.');
  }
  if (senha.length < 8) {
    throw new Error('ADMIN_SENHA deve ter pelo menos 8 caracteres.');
  }
  if (emProducao && /troque/i.test(senha)) {
    throw new Error('Defina uma ADMIN_SENHA real antes de executar em produção.');
  }

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);
  await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil)
     VALUES ($1, $2, $3, 'ADMINISTRADOR')`,
    [nome, email.trim().toLowerCase(), senhaHash],
  );
  log(`[seed] administrador inicial criado: ${email}`);
  return true;
}

// Execução direta: `npm run seed`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  semear()
    .then(() => pool.end())
    .catch(async (erro) => {
      console.error('[seed] ERRO:', erro.message);
      await pool.end();
      process.exit(1);
    });
}
