// Executor dos testes automatizados (DT21).
//
// Garante, ANTES de qualquer teste rodar, que:
//   1. NODE_ENV=test — é o que faz src/config/env.js escolher DATABASE_URL_TESTE;
//   2. DATABASE_URL_TESTE existe e aponta para um banco DIFERENTE do desenvolvimento;
//   3. o banco de teste existe (cria sozinho se não existir).
//
// Sem isso, `node --test` rodaria contra o banco de desenvolvimento e apagaria os dados
// que o autor usa para testar o sistema manualmente no navegador.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const arquivoEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

function falhar(mensagem) {
  console.error(`[testar] ERRO: ${mensagem}`);
  process.exit(1);
}

const urlTeste = process.env.DATABASE_URL_TESTE;
if (!urlTeste) {
  falhar(
    'DATABASE_URL_TESTE não está definida. Os testes precisam de um banco separado ' +
      'do desenvolvimento. Veja o .env.example.',
  );
}
if (urlTeste === process.env.DATABASE_URL) {
  falhar(
    'DATABASE_URL_TESTE aponta para o MESMO banco de DATABASE_URL. Os testes apagam ' +
      'dados a cada execução — use um banco dedicado (ex.: avaliacoes_teste).',
  );
}

// Cria o banco de teste se ainda não existir, conectando ao banco de manutenção
// "postgres" com as mesmas credenciais. Exige que o usuário tenha o atributo CREATEDB:
//   ALTER ROLE <usuario> CREATEDB;
async function garantirBancoDeTeste() {
  const alvo = new URL(urlTeste);
  const nome = decodeURIComponent(alvo.pathname.replace(/^\//, ''));
  if (!nome) falhar('DATABASE_URL_TESTE não indica o nome do banco.');

  const manutencao = new URL(urlTeste);
  manutencao.pathname = '/postgres';

  const client = new pg.Client({ connectionString: manutencao.toString() });
  try {
    await client.connect();
  } catch (erro) {
    falhar(
      `não foi possível conectar ao PostgreSQL para preparar o banco de teste: ${erro.message}\n` +
        '        Verifique se o serviço está rodando e se DATABASE_URL_TESTE está correta.',
    );
  }

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nome]);
    if (rowCount === 0) {
      // Nome vem do .env do próprio projeto; ainda assim é escapado como identificador.
      await client.query(`CREATE DATABASE "${nome.replace(/"/g, '""')}"`);
      console.log(`[testar] banco de teste "${nome}" criado.`);
    }
  } catch (erro) {
    falhar(
      `não foi possível criar o banco de teste "${nome}": ${erro.message}\n` +
        `        Crie-o manualmente ou conceda CREATEDB ao usuário: ALTER ROLE <usuario> CREATEDB;`,
    );
  } finally {
    await client.end();
  }

  return nome;
}

const nome = await garantirBancoDeTeste();
console.log(`[testar] usando o banco de teste "${nome}" (o banco de desenvolvimento não é tocado).`);

const filho = spawn(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    // Trava de rede: nenhum teste pode consultar serviço externo (ver tests/ajuda/sem-rede.js).
    '--import',
    './tests/ajuda/sem-rede.js',
    ...process.argv.slice(2),
    'tests/**/*.test.js',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Cache DESLIGADO na suíte, mesmo que o .env de quem roda diga CACHE_ATIVO=true.
      //
      // Duas razões. A suíte não pode depender de um servidor externo estar no ar — é a
      // mesma disciplina do banco de teste logo acima. E ela não pode mudar de
      // comportamento conforme a máquina: com o cache ligado, as asserções passariam a
      // exercitar o caminho do Redis em umas máquinas e o do PostgreSQL em outras, e
      // "passou aqui" deixaria de significar alguma coisa.
      //
      // Os casos que precisam do cache o ligam em código (tests/cache.test.js), que é
      // onde a dependência fica explícita. Para uma execução integrada, com Redis de
      // verdade em toda a suíte: CACHE_NOS_TESTES=true npm test.
      CACHE_ATIVO: process.env.CACHE_NOS_TESTES === 'true' ? 'true' : 'false',
    },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
);

filho.on('exit', (codigo, sinal) => process.exit(sinal ? 1 : codigo));
