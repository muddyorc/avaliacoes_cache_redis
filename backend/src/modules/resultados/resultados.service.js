// RF13 — Consultar Resultados (UC13), lado do professor.
//
// O estudante já consulta o que lhe cabe desde a P-23: a própria nota, a prova corrigida
// questão a questão e os indicadores que o professor liberar. O que faltava era a outra
// metade do requisito — o professor consultando o **histórico** da turma: quem fez cada
// avaliação, que nota tirou, o que ainda não foi corrigido, e o caminho para a prova por
// dentro (UC13 A2).
//
// A diferença em relação ao dashboard (RF12) é o propósito, e ela explica por que os dois
// existem. O dashboard responde "como foi o desempenho" com números agregados; aqui a
// pergunta é "como foi o desempenho **deste** estudante", e a resposta é nominal, prova
// por prova. Por isso o dashboard só conta prova com correção concluída (DT54) e esta
// consulta mostra **todas**, com a situação de cada uma: uma prova aguardando correção
// não é desempenho ruim, é trabalho pendente — e é informação que o professor precisa
// ver, não esconder.
//
// Recorte: só turmas do próprio professor, verificado em toda consulta.
import { query } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { ENCERRADAS, regularizarCorrecoesDoProfessor } from '../correcao/correcao.service.js';
import { arredondar, percentualDe, resumoDasNotas } from '../../dominio/estatisticas.js';

const TURMA_NAO_ENCONTRADA = 'Turma não encontrada.';

// Situações de vínculo que entram na consulta.
//
// Quem **saiu** continua aparecendo, marcado como tal. As provas que ele fez enquanto
// participava continuam existindo e continuam sendo histórico da turma (P-24, DT72):
// omiti-lo faria a soma das provas não fechar com a lista de estudantes, e o professor
// leria isso como defeito. PENDENTE e RECUSADA ficam fora — nunca houve participação.
const VINCULOS = ['APROVADA', 'SAIU'];

// A prova pertence à turma em que foi feita (migração 006).
//
// As provas anteriores a essa migração não têm turma registrada; para elas vale o vínculo
// do estudante, senão desapareceriam da consulta. Em todas as consultas deste módulo o
// identificador da turma é `$1` e a lista de vínculos é `$2`, o que permite reaproveitar
// os dois trechos abaixo como estão.
const PROVA_DA_TURMA = `(t.turma_id = $1 OR (t.turma_id IS NULL AND EXISTS (
            SELECT 1 FROM turma_estudante te
             WHERE te.turma_id = $1 AND te.estudante_id = t.estudante_id
               AND te.situacao = ANY($2))))`;

const AVALIACOES_DA_TURMA = 't.avaliacao_id IN (SELECT avaliacao_id FROM avaliacao_turma WHERE turma_id = $1)';

async function carregarTurma(turmaId, professorId) {
  const { rows } = await query(
    `SELECT t.id, t.nome, t.situacao,
            (SELECT count(*)::int FROM turma_estudante te
              WHERE te.turma_id = t.id AND te.situacao = 'APROVADA') AS estudantes,
            (SELECT count(*)::int FROM turma_estudante te
              WHERE te.turma_id = t.id AND te.situacao = 'SAIU') AS sairam
       FROM turma t
      WHERE t.id = $1 AND t.professor_id = $2`,
    [turmaId, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, TURMA_NAO_ENCONTRADA);
  return rows[0];
}

// As avaliações vinculadas à turma, na ordem em que o professor as reconhece: a mais
// recente primeiro.
async function avaliacoesDaTurma(turmaId) {
  const { rows } = await query(
    `SELECT a.id, a.titulo, a.status, a.data_fim, a.resultados_liberados,
            (SELECT coalesce(sum(pontuacao), 0) FROM avaliacao_questao WHERE avaliacao_id = a.id) AS pontuacao_maxima
       FROM avaliacao_turma at
       JOIN avaliacao a ON a.id = at.avaliacao_id AND a.status <> 'EXCLUIDA'
      WHERE at.turma_id = $1
      ORDER BY a.data_fim DESC, a.id DESC`,
    [turmaId],
  );
  return rows.map((a) => ({
    id: a.id,
    titulo: a.titulo,
    status: a.status,
    dataFim: a.data_fim,
    pontuacaoMaxima: Number(a.pontuacao_maxima),
    // O professor precisa saber o que o estudante já pode ver (P-07): a mesma nota que
    // ele está consultando aqui pode ainda não ter sido divulgada.
    resultadosLiberados: a.resultados_liberados,
  }));
}

// Converte uma linha de tentativa no formato que as telas consomem.
//
// A nota total só aparece com a correção concluída: antes disso ela é uma soma parcial, e
// apresentá-la como "nota" faria o professor ler como 4,0 uma prova que ainda vai valer
// 8,0. A pontuação das objetivas, essa sim, já é definitiva e aparece sempre.
function formatarProva(linha, pontuacaoMaxima) {
  const encerrada = ENCERRADAS.includes(linha.status);
  const total = linha.correcao_concluida && linha.pontuacao_total !== null ? Number(linha.pontuacao_total) : null;
  return {
    tentativaId: linha.id,
    status: linha.status,
    encerrada,
    emAndamento: linha.status === 'EM_ANDAMENTO',
    correcaoConcluida: linha.correcao_concluida,
    iniciadaEm: linha.iniciada_em,
    finalizadaEm: linha.finalizada_em,
    pontuacaoObjetiva: linha.pontuacao_objetiva === null ? null : Number(linha.pontuacao_objetiva),
    pontuacaoTotal: total,
    percentual: total === null ? null : percentualDe(total, pontuacaoMaxima),
    // Só prova encerrada pode ser aberta por dentro: a tela de correção recusa prova em
    // andamento, e com razão — o estudante ainda está respondendo.
    podeAbrir: encerrada,
  };
}

// A média do estudante é calculada **em percentual**: avaliações de pontuações diferentes
// só são comparáveis assim. É a mesma conta do dashboard da turma, pela mesma razão.
function mediaPercentual(provas) {
  const percentuais = provas.map((p) => p.percentual).filter((p) => p !== null);
  if (percentuais.length === 0) return null;
  return arredondar(percentuais.reduce((soma, p) => soma + p, 0) / percentuais.length, 1);
}

// ------------------------------------------------------- o que existe para consultar

// UC13, passo 3: as turmas do professor, com o tamanho do histórico de cada uma.
export async function listarTurmas(professorId) {
  // Prova entregue antes de a correção automática existir apareceria como "aguardando
  // correção" numa avaliação só de objetivas, que não depende do professor. Rotina
  // idempotente, a mesma da tela de correção e do dashboard.
  await regularizarCorrecoesDoProfessor(professorId);

  const { rows } = await query(
    `SELECT tu.id, tu.nome, tu.situacao,
            (SELECT count(*)::int FROM turma_estudante te
              WHERE te.turma_id = tu.id AND te.situacao = 'APROVADA') AS estudantes,
            (SELECT count(*)::int FROM turma_estudante te
              WHERE te.turma_id = tu.id AND te.situacao = 'SAIU') AS sairam,
            (SELECT count(*)::int FROM avaliacao_turma at
               JOIN avaliacao a ON a.id = at.avaliacao_id AND a.status <> 'EXCLUIDA'
              WHERE at.turma_id = tu.id) AS avaliacoes,
            p.provas, p.corrigidas
       FROM turma tu
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS provas,
                count(*) FILTER (WHERE t.correcao_concluida)::int AS corrigidas
           FROM tentativa t
          WHERE t.avaliacao_id IN (SELECT avaliacao_id FROM avaliacao_turma WHERE turma_id = tu.id)
            AND (t.turma_id = tu.id OR (t.turma_id IS NULL AND EXISTS (
                  SELECT 1 FROM turma_estudante te
                   WHERE te.turma_id = tu.id AND te.estudante_id = t.estudante_id
                     AND te.situacao = ANY($2))))
       ) p ON true
      WHERE tu.professor_id = $1
      ORDER BY lower(tu.nome)`,
    [professorId, VINCULOS],
  );

  return {
    turmas: rows.map((t) => ({
      id: t.id,
      nome: t.nome,
      situacao: t.situacao,
      totalEstudantes: t.estudantes,
      totalSairam: t.sairam,
      totalAvaliacoes: t.avaliacoes,
      provasRealizadas: t.provas ?? 0,
      provasCorrigidas: t.corrigidas ?? 0,
    })),
  };
}

// --------------------------------------------------------------- histórico da turma

// UC13 A2, passos 1 e 2: a relação de quem realizou as avaliações da turma.
//
// O formato é um quadro estudante × avaliação. Foi a forma escolhida porque responde de
// uma olhada as três perguntas que levam o professor até aqui: quem ainda não fez, quem
// foi mal, e o que falta corrigir. Uma lista por avaliação exigiria abrir uma a uma para
// descobrir o mesmo.
export async function daTurma(turmaId, professorId) {
  const turma = await carregarTurma(turmaId, professorId);
  await regularizarCorrecoesDoProfessor(professorId);

  const avaliacoes = await avaliacoesDaTurma(turmaId);
  const maximaPor = new Map(avaliacoes.map((a) => [a.id, a.pontuacaoMaxima]));

  const { rows: estudantes } = await query(
    `SELECT u.id, u.nome, u.email, te.situacao, te.saiu_em, (te.removido_por IS NOT NULL) AS removido
       FROM turma_estudante te
       JOIN usuario u ON u.id = te.estudante_id
      WHERE te.turma_id = $1 AND te.situacao = ANY($2)
      ORDER BY lower(u.nome)`,
    [turmaId, VINCULOS],
  );

  const { rows: tentativas } = await query(
    `SELECT t.id, t.avaliacao_id, t.estudante_id, t.status, t.correcao_concluida,
            t.iniciada_em, t.finalizada_em, t.pontuacao_objetiva, t.pontuacao_total
       FROM tentativa t
      WHERE ${AVALIACOES_DA_TURMA} AND ${PROVA_DA_TURMA}`,
    [turmaId, VINCULOS],
  );

  // Indexado por estudante e avaliação: é assim que a tela monta o quadro.
  const porEstudante = new Map();
  for (const linha of tentativas) {
    const prova = formatarProva(linha, maximaPor.get(linha.avaliacao_id) ?? 0);
    if (!porEstudante.has(linha.estudante_id)) porEstudante.set(linha.estudante_id, new Map());
    porEstudante.get(linha.estudante_id).set(linha.avaliacao_id, prova);
  }

  const lista = estudantes.map((e) => {
    const provas = porEstudante.get(e.id) ?? new Map();
    const encerradas = [...provas.values()].filter((p) => p.encerrada);
    return {
      estudanteId: e.id,
      nome: e.nome,
      email: e.email,
      vinculo: e.situacao,
      // Dizer "saiu da turma" sobre quem o professor removeu é falso. A tela escolhe o
      // texto por aqui.
      removido: e.removido === true,
      saiuEm: e.saiu_em,
      realizadas: provas.size,
      naoRealizadas: avaliacoes.length - provas.size,
      corrigidas: encerradas.filter((p) => p.correcaoConcluida).length,
      aguardandoCorrecao: encerradas.filter((p) => !p.correcaoConcluida).length,
      mediaPercentual: mediaPercentual([...provas.values()]),
      // Chaveado pelo identificador da avaliação, para a tela cruzar com a coluna.
      provas: Object.fromEntries(provas),
    };
  });

  const todasAsProvas = lista.flatMap((e) => Object.values(e.provas));
  const encerradas = todasAsProvas.filter((p) => p.encerrada);
  const medias = lista.map((e) => e.mediaPercentual).filter((m) => m !== null);

  return {
    turma: {
      id: turma.id,
      nome: turma.nome,
      situacao: turma.situacao,
      totalEstudantes: turma.estudantes,
      totalSairam: turma.sairam,
    },
    avaliacoes,
    estudantes: lista,
    resumo: {
      estudantes: lista.length,
      avaliacoes: avaliacoes.length,
      provasRealizadas: todasAsProvas.length,
      provasCorrigidas: encerradas.filter((p) => p.correcaoConcluida).length,
      aguardandoCorrecao: encerradas.filter((p) => !p.correcaoConcluida).length,
      emAndamento: todasAsProvas.filter((p) => p.emAndamento).length,
      // Em percentual, como a média de cada estudante — e pela mesma razão.
      resumoDasMedias: resumoDasNotas(medias),
    },
    // Quem decide se há o que mostrar é o servidor, como no dashboard: a tela explica o
    // motivo em vez de desenhar um quadro vazio.
    temDados: lista.length > 0 && avaliacoes.length > 0,
    motivoSemDados:
      avaliacoes.length === 0
        ? 'Esta turma ainda não tem avaliações vinculadas.'
        : lista.length === 0
          ? 'Esta turma ainda não tem estudantes aprovados.'
          : null,
  };
}

// ----------------------------------------------------------- histórico do estudante

// UC13 A2, passo 3: o professor seleciona um estudante e vê o histórico dele na turma —
// cada avaliação vinculada, com a prova que ele fez ou a ausência dela.
export async function doEstudanteNaTurma(turmaId, estudanteId, professorId) {
  const turma = await carregarTurma(turmaId, professorId);
  await regularizarCorrecoesDoProfessor(professorId);

  const { rows: vinculos } = await query(
    `SELECT u.id, u.nome, u.email, te.situacao, te.solicitado_em, te.decidido_em, te.saiu_em,
            (te.removido_por IS NOT NULL) AS removido
       FROM turma_estudante te
       JOIN usuario u ON u.id = te.estudante_id
      WHERE te.turma_id = $1 AND te.estudante_id = $3 AND te.situacao = ANY($2)`,
    [turmaId, VINCULOS, estudanteId],
  );
  // Estudante que nunca participou desta turma não é "acesso negado", é inexistente neste
  // recorte — e a mensagem não revela se a conta existe no sistema.
  if (!vinculos[0]) throw new ErroApp(404, 'Estudante não encontrado nesta turma.');
  const estudante = vinculos[0];

  const avaliacoes = await avaliacoesDaTurma(turmaId);

  const { rows: tentativas } = await query(
    `SELECT t.id, t.avaliacao_id, t.status, t.correcao_concluida,
            t.iniciada_em, t.finalizada_em, t.pontuacao_objetiva, t.pontuacao_total,
            (SELECT count(*)::int FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
              WHERE aq.avaliacao_id = t.avaliacao_id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA') AS total_discursivas,
            (SELECT count(*)::int FROM resposta r
               JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id AND aq.questao_id = r.questao_id
               JOIN questao q ON q.id = r.questao_id
              WHERE r.tentativa_id = t.id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA'
                AND r.nota_final IS NOT NULL) AS discursivas_corrigidas
       FROM tentativa t
      WHERE ${AVALIACOES_DA_TURMA} AND t.estudante_id = $3 AND ${PROVA_DA_TURMA}`,
    [turmaId, VINCULOS, estudanteId],
  );

  const porAvaliacao = new Map(tentativas.map((t) => [t.avaliacao_id, t]));

  const historico = avaliacoes.map((a) => {
    const linha = porAvaliacao.get(a.id);
    return {
      ...a,
      prova: linha
        ? {
            ...formatarProva(linha, a.pontuacaoMaxima),
            totalDiscursivas: linha.total_discursivas,
            discursivasCorrigidas: linha.discursivas_corrigidas,
          }
        : null,
    };
  });

  const provas = historico.map((a) => a.prova).filter(Boolean);
  const encerradas = provas.filter((p) => p.encerrada);

  return {
    turma: { id: turma.id, nome: turma.nome, situacao: turma.situacao },
    estudante: {
      id: estudante.id,
      nome: estudante.nome,
      email: estudante.email,
      vinculo: estudante.situacao,
      removido: estudante.removido === true,
      entrouEm: estudante.decidido_em ?? estudante.solicitado_em,
      saiuEm: estudante.saiu_em,
    },
    avaliacoes: historico,
    resumo: {
      avaliacoes: avaliacoes.length,
      realizadas: provas.length,
      naoRealizadas: avaliacoes.length - provas.length,
      corrigidas: encerradas.filter((p) => p.correcaoConcluida).length,
      aguardandoCorrecao: encerradas.filter((p) => !p.correcaoConcluida).length,
      emAndamento: provas.filter((p) => p.emAndamento).length,
      mediaPercentual: mediaPercentual(provas),
    },
    temDados: avaliacoes.length > 0,
    motivoSemDados: avaliacoes.length === 0 ? 'Esta turma ainda não tem avaliações vinculadas.' : null,
  };
}
