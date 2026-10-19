// Teste de ESTRESSE da API — o sistema sob a carga que ele vai encontrar na aula.
//
// Por que um cenário e não um "flood" de uma rota: o momento crítico deste sistema não é
// uma URL qualquer repetida mil vezes; é a turma inteira fazendo a prova ao mesmo tempo,
// cada estudante com o salvamento automático disparando a cada 10 segundos (UC09), e
// todos entregando por volta do mesmo instante. É isso que este script reproduz.
//
// O que ele mede, por operação e no total: quantas requisições, quantas falharam, e a
// latência em média, p50, p95, p99 e máximo. Percentil importa mais que média: a média
// esconde justamente o estudante que esperou seis segundos para salvar.
//
// SEGURANÇA: roda contra a API de TESTE. O script recusa rodar com NODE_ENV diferente de
// "test" e semeia os próprios dados no banco de teste. O banco de desenvolvimento, com os
// dados que o autor usa no navegador, nunca é tocado.
//
// Uso:
//   NODE_ENV=test node scripts/estresse.js --alunos=30 --ciclos=6 --url=http://localhost:3001
//
//   --alunos   estudantes simultâneos (padrão 30)
//   --ciclos   salvamentos automáticos por estudante (padrão 6, ~1 minuto de prova)
//   --url      base da API de teste (padrão http://localhost:3001)
//   --questoes questões da prova (padrão 10)
//   --monitoramento  0 desliga o envio de eventos (padrão 1)
//
// MONITORAMENTO (RF10): a prova do cenário nasce com o monitoramento ligado, e cada
// estudante envia lotes de eventos durante a prova, como a tela faz de verdade. A tela
// envia a cada 4 s e salva as respostas a cada 10 s, então cabem ~2 lotes por ciclo de
// salvamento — é essa proporção que o script reproduz. Sem isso, a medição descreveria
// um sistema que deixou de existir quando o RF10 entrou.
//
// IA: este script **nunca** toca no serviço de Inteligência Artificial. Ele exercita o
// painel de correção (a listagem), que não pede sugestão nenhuma. Rode a API do teste com
// IA_PROVEDOR=simulado para que nem por engano exista chamada paga numa medição de carga.
import { randomUUID } from 'node:crypto';
import { pool, query } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

if (process.env.NODE_ENV !== 'test') {
  console.error(
    '[estresse] ERRO: rode com NODE_ENV=test.\n' +
      '           O teste cria dezenas de contas e milhares de respostas; isso não pode\n' +
      '           acontecer no banco de desenvolvimento.',
  );
  process.exit(1);
}

const argumento = (nome, padrao) => {
  const achado = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=')[1] : padrao;
};

const ALUNOS = Number(argumento('alunos', 30));
const CICLOS = Number(argumento('ciclos', 6));
const QUESTOES = Number(argumento('questoes', 10));
const BASE = argumento('url', 'http://localhost:3001');
const MONITORAMENTO = argumento('monitoramento', '1') !== '0';
const SENHA = 'senha-de-estresse-123';

// ------------------------------------------------------------------ medição

const medidas = new Map();

function registrar(operacao, ms, ok) {
  if (!medidas.has(operacao)) medidas.set(operacao, { tempos: [], erros: 0 });
  const m = medidas.get(operacao);
  m.tempos.push(ms);
  if (!ok) m.erros += 1;
}

function percentil(ordenados, p) {
  if (ordenados.length === 0) return 0;
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[indice];
}

async function medir(operacao, executar) {
  const inicio = performance.now();
  let ok;
  let resposta;
  try {
    resposta = await executar();
    ok = resposta.status < 400;
  } catch {
    ok = false;
  }
  registrar(operacao, performance.now() - inicio, ok);
  return resposta;
}

async function http(caminho, { metodo = 'GET', corpo, cookie } = {}) {
  const r = await fetch(`${BASE  }/api${  caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  return {
    status: r.status,
    corpo: texto ? JSON.parse(texto) : null,
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
}

// --------------------------------------------------------- preparação do cenário
//
// Os dados são semeados direto no banco, e não pela API: criar 30 contas por HTTP
// esbarraria no limite de autocadastro por IP e mediríamos o limitador, não o sistema.

async function semear() {
  const marca = randomUUID().slice(0, 8);
  const { default: bcrypt } = await import('bcryptjs');
  const hash = bcrypt.hashSync(SENHA, 10);

  const { rows: professores } = await query(
    `INSERT INTO usuario (nome, email, senha_hash, perfil)
     VALUES ($1, $2, $3, 'PROFESSOR') RETURNING id`,
    [`Prof Estresse ${marca}`, `prof.estresse.${marca}@exemplo.com`, hash],
  );
  const professorId = professores[0].id;

  const { rows: turmas } = await query(
    `INSERT INTO turma (professor_id, nome, codigo_acesso, requer_aprovacao)
     VALUES ($1, $2, $3, FALSE) RETURNING id`,
    [professorId, `Turma Estresse ${marca}`, marca.toUpperCase().padEnd(8, 'X').slice(0, 8)],
  );
  const turmaId = turmas[0].id;

  const agora = Date.now();
  const { rows: avaliacoes } = await query(
    // `limite_ocorrencias` fica NULL de propósito: com limite, os estudantes simulados
    // seriam bloqueados no meio e a medição acabaria antes da hora. O que se quer medir é
    // o custo de **registrar** os eventos, não a regra de bloqueio — essa já tem teste.
    `INSERT INTO avaliacao (professor_id, titulo, descricao, data_inicio, data_fim, duracao_minutos,
                            status, visibilidade, monitoramento_ativo, limite_ocorrencias)
     VALUES ($1, $2, 'Prova do teste de estresse.', $3, $4, 180, 'PUBLICADA', 'PRIVADA', $5, NULL)
     RETURNING id`,
    [professorId, `Prova Estresse ${marca}`, new Date(agora - 3600e3), new Date(agora + 6 * 3600e3), MONITORAMENTO],
  );
  const avaliacaoId = avaliacoes[0].id;
  await query('INSERT INTO avaliacao_turma (avaliacao_id, turma_id) VALUES ($1, $2)', [avaliacaoId, turmaId]);

  for (let i = 1; i <= QUESTOES; i += 1) {
    const { rows: questoes } = await query(
      `INSERT INTO questao (professor_id, tipo, enunciado, pontuacao_padrao, tema)
       VALUES ($1, 'OBJETIVA', $2, 1, 'Estresse') RETURNING id`,
      [professorId, `Questão ${i} da prova de estresse: qual alternativa está correta?`],
    );
    const questaoId = questoes[0].id;
    for (let a = 1; a <= 4; a += 1) {
      await query(
        'INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, $2, $3, $4)',
        [questaoId, a, `Alternativa ${a}`, a === 1],
      );
    }
    await query(
      'INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, $3, 1)',
      [avaliacaoId, questaoId, i],
    );
  }

  const estudantes = [];
  for (let i = 1; i <= ALUNOS; i += 1) {
    const email = `aluno.estresse.${marca}.${i}@exemplo.com`;
    const { rows } = await query(
      `INSERT INTO usuario (nome, email, senha_hash, perfil)
       VALUES ($1, $2, $3, 'ESTUDANTE') RETURNING id`,
      [`Aluno Estresse ${i}`, email, hash],
    );
    await query(
      `INSERT INTO turma_estudante (turma_id, estudante_id, situacao, decidido_em)
       VALUES ($1, $2, 'APROVADA', now())`,
      [turmaId, rows[0].id],
    );
    estudantes.push({ email });
  }

  return { professor: `prof.estresse.${marca}@exemplo.com`, avaliacaoId, turmaId, estudantes };
}

// ------------------------------------------------------- a jornada de um estudante
//
// Entrar, iniciar a prova, salvar respostas em ciclos (como o autosave faz) e entregar.
// Todos os estudantes fazem isso ao mesmo tempo — é essa simultaneidade que se mede.

// Um lote como o que a tela envia: o que o navegador observou nos últimos 4 segundos.
// A mistura reproduz o que acontece de verdade — muita perda de foco e troca de aba,
// atalho de vez em quando.
const TIPOS_DE_EVENTO = ['PERDA_FOCO', 'TROCA_ABA', 'PERDA_FOCO', 'ATALHO', 'TROCA_ABA'];

function loteDeEventos(semente) {
  const quantidade = 1 + (semente % 3);
  return Array.from({ length: quantidade }, (_, i) => {
    const tipo = TIPOS_DE_EVENTO[(semente + i) % TIPOS_DE_EVENTO.length];
    return { tipo, detalhe: tipo === 'ATALHO' ? 'Ctrl+C' : null };
  });
}

async function jornada(estudante, avaliacaoId) {
  const login = await medir('login', () =>
    http('/auth/login', { metodo: 'POST', corpo: { email: estudante.email, senha: SENHA } }),
  );
  const cookie = login?.cookie;
  if (!cookie) return;

  const inicio = await medir('iniciar prova', () =>
    http(`/estudante/avaliacoes/${avaliacaoId}/iniciar`, { metodo: 'POST', cookie }),
  );
  const questoes = inicio?.corpo?.questoes ?? [];
  if (questoes.length === 0) return;

  for (let ciclo = 0; ciclo < CICLOS; ciclo += 1) {
    // Cada ciclo responde mais um pedaço da prova, como quem vai avançando nas questões.
    const ateAqui = Math.max(1, Math.ceil(((ciclo + 1) / CICLOS) * questoes.length));
    const respostas = questoes.slice(0, ateAqui).map((q) => ({
      questaoId: q.questaoId,
      alternativaId: q.alternativas[ciclo % q.alternativas.length].id,
    }));
    await medir('salvar respostas', () =>
      http(`/estudante/avaliacoes/${avaliacaoId}/respostas`, { metodo: 'PUT', cookie, corpo: { respostas } }),
    );

    // Dois lotes por ciclo: a tela envia eventos a cada 4 s e salva a cada 10 s.
    if (MONITORAMENTO) {
      for (let lote = 0; lote < 2; lote += 1) {
        await medir('eventos de monitoramento', () =>
          http(`/estudante/avaliacoes/${avaliacaoId}/eventos`, {
            metodo: 'POST',
            cookie,
            corpo: { eventos: loteDeEventos(ciclo * 2 + lote) },
          }),
        );
      }
    }
  }

  await medir('entregar prova', () =>
    http(`/estudante/avaliacoes/${avaliacaoId}/finalizar`, { metodo: 'POST', cookie, corpo: { respostas: [] } }),
  );
}

// ----------------------------------------------------------------- relatório

function relatorio(duracaoSegundos) {
  const linhas = [];
  let totalRequisicoes = 0;
  let totalErros = 0;

  for (const [operacao, m] of medidas) {
    const ordenados = [...m.tempos].sort((a, b) => a - b);
    const soma = ordenados.reduce((t, v) => t + v, 0);
    totalRequisicoes += ordenados.length;
    totalErros += m.erros;
    linhas.push({
      operacao,
      requisicoes: ordenados.length,
      erros: m.erros,
      media: Math.round(soma / ordenados.length),
      p50: Math.round(percentil(ordenados, 50)),
      p95: Math.round(percentil(ordenados, 95)),
      p99: Math.round(percentil(ordenados, 99)),
      max: Math.round(ordenados[ordenados.length - 1]),
    });
  }

  console.log('\n================ TESTE DE ESTRESSE ================');
  console.log(`Alunos simultâneos : ${ALUNOS}`);
  console.log(`Questões da prova  : ${QUESTOES}`);
  console.log(`Salvamentos/aluno  : ${CICLOS}`);
  console.log(`Duração total      : ${duracaoSegundos.toFixed(1)} s`);
  console.log(`Requisições        : ${totalRequisicoes} (${(totalRequisicoes / duracaoSegundos).toFixed(1)} req/s)`);
  console.log(`Erros              : ${totalErros}`);
  console.log('\nOperação            Reqs   Erros   média     p50     p95     p99     máx   (ms)');
  console.log('--------------------------------------------------------------------------------');
  for (const l of linhas) {
    console.log(
      `${l.operacao.padEnd(20)}${String(l.requisicoes).padStart(4)}${String(l.erros).padStart(8)}` +
        `${String(l.media).padStart(8)}${String(l.p50).padStart(8)}${String(l.p95).padStart(8)}` +
        `${String(l.p99).padStart(8)}${String(l.max).padStart(8)}`,
    );
  }
  console.log('====================================================\n');
  return { totalRequisicoes, totalErros, linhas };
}

// --------------------------------------------------------------------- execução

const saude = await fetch(`${BASE  }/api/saude`).catch(() => null);
if (!saude || !saude.ok) {
  console.error(`[estresse] ERRO: a API de teste não respondeu em ${BASE}.`);
  console.error('           Suba-a antes: NODE_ENV=test PORT=3001 npm run dev');
  await pool.end();
  process.exit(1);
}

console.log(`[estresse] banco de teste: ${env.databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
console.log(`[estresse] semeando ${ALUNOS} estudantes e uma prova de ${QUESTOES} questões...`);
const cenario = await semear();

console.log('[estresse] disparando todos os estudantes ao mesmo tempo...');
const inicio = performance.now();
await Promise.all(cenario.estudantes.map((e) => jornada(e, cenario.avaliacaoId)));
const duracao = (performance.now() - inicio) / 1000;

// Depois da prova: o professor abre a correção e o dashboard, com a turma inteira dentro.
const prof = await http('/auth/login', { metodo: 'POST', corpo: { email: cenario.professor, senha: SENHA } });
await medir('painel de correção', () => http(`/correcao/${cenario.avaliacaoId}`, { cookie: prof.cookie }));
await medir('dashboard da avaliação', () =>
  http(`/dashboard/avaliacoes/${cenario.avaliacaoId}`, { cookie: prof.cookie }),
);
await medir('dashboard da turma', () => http(`/dashboard/turmas/${cenario.turmaId}`, { cookie: prof.cookie }));
if (MONITORAMENTO) {
  await medir('relatório de monitoramento', () =>
    http(`/monitoramento/${cenario.avaliacaoId}`, { cookie: prof.cookie }),
  );
}

const resumo = relatorio(duracao);
await pool.end();
process.exit(resumo.totalErros > 0 ? 1 : 0);
