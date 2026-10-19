// Medição de BASELINE de uma operação — o "antes" de qualquer otimização.
//
// Diferença em relação ao `estresse.js`: lá o cenário é a turma inteira sob carga
// simultânea, medida por HTTP, e o que interessa são os percentis. Aqui é o oposto —
// **uma** operação, chamada em série N vezes, sem rede e sem concorrência, para obter um
// custo médio estável e comparável depois da mudança. Um número que o p95 não dá.
//
// A operação medida é `questoesDaProva` (realizacao.service.js): as 3 consultas que
// carregam a estrutura da prova. Ela foi escolhida porque o autosave a executa a cada
// 10 s por estudante, e numa prova congelada o resultado é imutável — é o candidato
// número um a cache, e cache sem baseline é fé, não engenharia.
//
// SEGURANÇA — três travas, porque medir não pode custar dados de verdade:
//   1. recusa rodar com NODE_ENV diferente de "test";
//   2. sob NODE_ENV=test o env.js resolve DATABASE_URL_TESTE e já recusa se ela for igual
//      à DATABASE_URL (DT21);
//   3. confere o host da conexão e **para** se não for local. O banco do Render nunca é
//      tocado por este script, nem por engano de variável de ambiente.
//
// Uso:
//   NODE_ENV=test node scripts/medir.js --n=1000
//
//   --n            repetições medidas (padrão 1000)
//   --aquecimento  chamadas descartadas antes de medir (padrão 100)
//   --questoes     questões da prova (padrão 40)
//   --alternativas alternativas por questão (padrão 5)
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { pool, query } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

// ----------------------------------------------------------------------- travas

if (process.env.NODE_ENV !== 'test') {
  console.error(
    '[medir] ERRO: rode com NODE_ENV=test.\n' +
      '        O script cria uma prova inteira e centenas de alternativas; isso não\n' +
      '        acontece no banco de desenvolvimento.',
  );
  process.exit(1);
}

const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const destino = new URL(env.databaseUrl);
if (!HOSTS_LOCAIS.includes(destino.hostname)) {
  console.error(
    `[medir] ERRO: a conexão aponta para "${destino.hostname}", que não é local.\n` +
      '        Medição só roda contra banco local. Verifique DATABASE_URL_TESTE.',
  );
  process.exit(1);
}

const argumento = (nome, padrao) => {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=')[1] : padrao;
};

const N = Number(argumento('n', 1000));
const AQUECIMENTO = Number(argumento('aquecimento', 100));
const QUESTOES = Number(argumento('questoes', 40));
const ALTERNATIVAS = Number(argumento('alternativas', 5));

const ORIGEM = new URL('../src/modules/realizacao/realizacao.service.js', import.meta.url);

// --------------------------------------- carregar uma função privada do módulo
//
// `questoesDaProva` não é exportada, e exportá-la só para medir mudaria um arquivo de
// produção por causa de um script de diagnóstico — a cauda abanando o cachorro. Em vez
// disso o fonte é lido, os especificadores relativos viram URLs absolutas (um módulo
// `data:` não tem diretório contra o qual resolver caminho relativo) e o export é
// anexado ao final. O corpo da função medida fica idêntico ao que roda de verdade, e se
// alguém mudar o arquivo a medição acompanha sozinha.
async function carregarQuestoesDaProva() {
  const fonte = await readFile(ORIGEM, 'utf8');

  const absoluto = fonte.replace(
    /(\bfrom\s*)(['"])(\.[^'"]+)\2/g,
    (_todo, antes, aspas, caminho) => `${antes}${aspas}${new URL(caminho, ORIGEM).href}${aspas}`,
  );

  const modulo = `${absoluto}\nexport { questoesDaProva };\n`;
  const { questoesDaProva } = await import(
    `data:text/javascript;base64,${Buffer.from(modulo).toString('base64')}`
  );

  if (typeof questoesDaProva !== 'function') {
    throw new Error('questoesDaProva não foi encontrada em realizacao.service.js.');
  }
  return questoesDaProva;
}

// ------------------------------------------------------- preparação do cenário
//
// Semeado direto no banco, pelo mesmo caminho que o `estresse.js` usa: montar isso pela
// API exigiria login, publicação e um estudante iniciando a prova, e mediríamos o
// percurso inteiro em vez da operação.

async function semear(congelarQuestoes) {
  const marca = randomUUID().slice(0, 8);

  const { rows: professores } = await query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil)
     VALUES ($1, $2, 'sem-login-neste-script', 'PROFESSOR') RETURNING id`,
    [`Prof Medição ${marca}`, `prof.medicao.${marca}@exemplo.com`],
  );
  const professorId = professores[0].id;

  const agora = Date.now();
  const { rows: avaliacoes } = await query(
    `INSERT INTO avaliacao (professor_id, titulo, descricao, data_inicio, data_fim, duracao_minutos,
                            status, visibilidade, monitoramento_ativo, limite_ocorrencias)
     VALUES ($1, $2, 'Prova da medição de baseline.', $3, $4, 180, 'PUBLICADA', 'PRIVADA', FALSE, NULL)
     RETURNING id`,
    [professorId, `Prova Medição ${marca}`, new Date(agora - 3600e3), new Date(agora + 6 * 3600e3)],
  );
  const avaliacaoId = avaliacoes[0].id;

  for (let i = 1; i <= QUESTOES; i += 1) {
    const { rows: questoes } = await query(
      `INSERT INTO questao (professor_id, tipo, enunciado, pontuacao_padrao, tema)
       VALUES ($1, 'OBJETIVA', $2, 1, 'Medição') RETURNING id`,
      [professorId, `Questão ${i} da prova de medição: qual alternativa está correta?`],
    );
    const questaoId = questoes[0].id;
    for (let a = 1; a <= ALTERNATIVAS; a += 1) {
      await query('INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, $2, $3, $4)', [
        questaoId,
        a,
        `Alternativa ${a} da questão ${i}`,
        a === 1,
      ]);
    }
    await query('INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, $3, 1)', [
      avaliacaoId,
      questaoId,
      i,
    ]);
  }

  // Congelar é parte do cenário, não detalhe: na prova congelada `questoesDaProva` lê a
  // cópia (`avaliacao_alternativa`), que é o caminho que o autosave percorre de verdade.
  const congelou = await congelarQuestoes({ query }, avaliacaoId);
  if (!congelou) throw new Error('A prova não congelou — cenário inválido para a medição.');

  return { avaliacaoId };
}

// ------------------------------------------------------------------- ambiente

async function ambiente() {
  const { rows } = await query('SELECT current_setting($1) AS versao', ['server_version']);
  const cpus = os.cpus();
  return {
    postgres: rows[0].versao,
    so: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    processador: `${cpus[0]?.model?.trim() ?? 'desconhecido'} — ${cpus.length} núcleos lógicos`,
    ram: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
    node: process.version,
  };
}

// ------------------------------------------------------------------- execução

async function principal() {
  const questoesDaProva = await carregarQuestoesDaProva();
  const { congelarQuestoes } = await import('../src/modules/realizacao/realizacao.service.js');

  console.log(`[medir] banco: ${destino.hostname}:${destino.port || 5432}/${destino.pathname.replace(/^\//, '')}`);
  console.log(`[medir] semeando prova com ${QUESTOES} questões × ${ALTERNATIVAS} alternativas...`);
  const { avaliacaoId } = await semear(congelarQuestoes);

  // Confere o que foi realmente semeado, em vez de confiar nos parâmetros: uma prova
  // menor do que se pediu produziria um número bonito e errado.
  const { rows: conferencia } = await query(
    `SELECT (SELECT count(*)::int FROM avaliacao_questao WHERE avaliacao_id = $1) AS questoes,
            (SELECT count(*)::int FROM avaliacao_alternativa WHERE avaliacao_id = $1) AS alternativas`,
    [avaliacaoId],
  );
  const { questoes, alternativas } = conferencia[0];

  // Aquecimento descartado: as primeiras chamadas pagam compilação do JIT, o primeiro
  // plano de consulta e o cache frio do Postgres. Medir isso junto mede a partida.
  console.log(`[medir] aquecendo (${AQUECIMENTO} chamadas, descartadas)...`);
  for (let i = 0; i < AQUECIMENTO; i += 1) {
    await questoesDaProva({ query }, avaliacaoId);
  }

  console.log(`[medir] medindo ${N} chamadas...`);
  const inicio = performance.now();
  for (let i = 0; i < N; i += 1) {
    await questoesDaProva({ query }, avaliacaoId);
  }
  const total = performance.now() - inicio;

  const amb = await ambiente();
  console.log(`
+-- BASELINE: questoesDaProva (realizacao.service.js) --------------------
|  N (repetições medidas)    ${N}
|  aquecimento descartado    ${AQUECIMENTO}
|  tempo total               ${total.toFixed(2)} ms
|  tempo médio por operação  ${(total / N).toFixed(4)} ms
|  operações por segundo     ${(N / (total / 1000)).toFixed(1)}
+-- cenário --------------------------------------------------------------
|  questões                  ${questoes}
|  alternativas              ${alternativas} (${alternativas / questoes} por questão)
|  prova congelada           sim (lê avaliacao_alternativa)
|  consultas por operação    3
+-- ambiente -------------------------------------------------------------
|  PostgreSQL                ${amb.postgres}
|  Node                      ${amb.node}
|  sistema operacional       ${amb.so}
|  processador               ${amb.processador}
|  memória RAM               ${amb.ram}
+------------------------------------------------------------------------`);
}

principal()
  .catch((erro) => {
    console.error('[medir] falhou:', erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
