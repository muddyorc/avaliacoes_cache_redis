// Confere se a estrutura de DOIS bancos é a mesma.
//
// Nasceu de uma pergunta concreta (18/10/2026): depois de publicar no Render, como saber
// se o banco de lá ficou igual ao daqui? O deploy roda as migrações sozinho, mas "rodou
// sem erro" e "ficou igual" não são a mesma afirmação — uma migração aplicada pela
// metade, um ALTER manual esquecido ou um deploy que não chegou a subir produzem bancos
// que divergem em silêncio, e a divergência só aparece quando uma tela quebra.
//
// SOMENTE LEITURA. Não há um único INSERT, UPDATE, DELETE, CREATE ou ALTER aqui, e é
// proposital: este script existe para ser apontado para produção sem medo. Ele lê o
// catálogo do PostgreSQL (information_schema e pg_constraint), compara, e imprime.
//
// Uso:
//   node backend/scripts/conferir-banco.js "<URL_DO_OUTRO_BANCO>"
//
// O banco de referência é o do `.env` local (DATABASE_URL). A URL passada como argumento
// é a que será comparada contra ele — tipicamente a "External Database URL" do Render.
// A senha nunca é impressa: a saída mostra só host e nome do banco.
import pg from 'pg';
import { env } from '../src/config/env.js';

const alvo = process.argv[2];
if (!alvo) {
  console.error(
    'Informe a URL do banco a conferir:\n' +
      '  node backend/scripts/conferir-banco.js "postgresql://..."\n\n' +
      'No Render: painel do banco > Connections > External Database URL.',
  );
  process.exit(1);
}

const apelido = (texto) => {
  const u = new URL(texto);
  return `${u.hostname}/${u.pathname.slice(1)}`;
};

// ------------------------------------------------------------------ o que comparamos

// Colunas: nome, tipo, se aceita nulo e o padrão. É o que quebra uma consulta quando
// difere — uma coluna faltando, um NOT NULL a mais, um tipo trocado.
const COLUNAS = `
  SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo,
         is_nullable AS aceita_nulo, coalesce(column_default, '') AS padrao
    FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, column_name`;

// Restrições: é onde moram as regras que o código assume — o CHECK de status, as chaves
// estrangeiras, os índices únicos. `pg_get_constraintdef` devolve o texto normalizado,
// então a comparação não depende de como a migração foi escrita.
const RESTRICOES = `
  SELECT c.conrelid::regclass::text AS tabela, c.conname AS nome,
         pg_get_constraintdef(c.oid) AS definicao
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname = 'public'
   ORDER BY 1, 2`;

const INDICES = `
  SELECT tablename AS tabela, indexname AS nome, indexdef AS definicao
    FROM pg_indexes WHERE schemaname = 'public'
   ORDER BY tablename, indexname`;

const MIGRACOES = `SELECT versao FROM schema_migrations ORDER BY versao`;

async function retratar(url) {
  const cliente = new pg.Client({
    connectionString: url,
    // O Render exige TLS e usa certificado próprio; sem isto a conexão é recusada.
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  });
  await cliente.connect();
  try {
    // Uma consulta por vez: um `Client` do pg atende uma por conexão, e disparar as
    // três em paralelo sobre o mesmo cliente é uso incorreto da biblioteca.
    const colunas = await cliente.query(COLUNAS);
    const restricoes = await cliente.query(RESTRICOES);
    const indices = await cliente.query(INDICES);
    let migracoes = [];
    try {
      migracoes = (await cliente.query(MIGRACOES)).rows.map((r) => r.versao);
    } catch {
      // Banco que nunca rodou o migrate não tem a tabela. É um achado, não um erro.
    }
    return {
      migracoes,
      colunas: colunas.rows.map((r) => [`${r.tabela}.${r.coluna}`, `${r.tipo} nulo=${r.aceita_nulo} padrao=${r.padrao}`]),
      restricoes: restricoes.rows.map((r) => [`${r.tabela}.${r.nome}`, r.definicao]),
      indices: indices.rows.map((r) => [`${r.tabela}.${r.nome}`, r.definicao]),
    };
  } finally {
    await cliente.end();
  }
}

// ------------------------------------------------------------------ a comparação

function comparar(titulo, aqui, la) {
  const mapaAqui = new Map(aqui);
  const mapaLa = new Map(la);
  const faltando = [...mapaAqui.keys()].filter((k) => !mapaLa.has(k));
  const sobrando = [...mapaLa.keys()].filter((k) => !mapaAqui.has(k));
  const diferentes = [...mapaAqui.keys()].filter((k) => mapaLa.has(k) && mapaLa.get(k) !== mapaAqui.get(k));

  if (!faltando.length && !sobrando.length && !diferentes.length) {
    console.log(`  ok   ${titulo}: ${mapaAqui.size} iguais`);
    return 0;
  }

  console.log(`  XX   ${titulo}:`);
  for (const k of faltando) console.log(`         FALTA no outro banco: ${k}`);
  for (const k of sobrando) console.log(`         SÓ existe no outro:   ${k}`);
  for (const k of diferentes) {
    console.log(`         DIFERE: ${k}\n           aqui: ${mapaAqui.get(k)}\n           lá:   ${mapaLa.get(k)}`);
  }
  return faltando.length + sobrando.length + diferentes.length;
}

console.log(`referência (local): ${apelido(env.databaseUrl)}`);
console.log(`comparando com:     ${apelido(alvo)}\n`);

const [aqui, la] = await Promise.all([retratar(env.databaseUrl), retratar(alvo)]);

console.log('Migrações registradas:');
const soAqui = aqui.migracoes.filter((m) => !la.migracoes.includes(m));
if (la.migracoes.length === 0) {
  console.log('  XX   o outro banco não tem a tabela schema_migrations: o migrate nunca rodou nele');
} else if (soAqui.length === 0) {
  console.log(`  ok   as ${la.migracoes.length} migrações daqui também estão lá`);
} else {
  console.log(`  XX   faltam lá: ${soAqui.join(', ')}`);
}

console.log('\nEstrutura:');
const divergencias =
  comparar('colunas', aqui.colunas, la.colunas) +
  comparar('restrições', aqui.restricoes, la.restricoes) +
  comparar('índices', aqui.indices, la.indices) +
  soAqui.length +
  (la.migracoes.length === 0 ? 1 : 0);

console.log(
  divergencias === 0
    ? '\nRESULTADO: os dois bancos têm a mesma estrutura.'
    : `\nRESULTADO: ${divergencias} divergência(s). Veja acima.`,
);
process.exit(divergencias === 0 ? 0 : 1);
