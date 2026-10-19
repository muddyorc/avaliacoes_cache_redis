// RF12 — Exibir Dashboard de Desempenho (UC12).
//
// Indicadores consolidados para o professor analisar uma avaliação ou uma turma:
// média, distribuição das notas, estudantes abaixo da média e as questões com maior
// índice de acertos e de erros (P-14).
//
// Só entram no cálculo as provas com a **correção concluída** (RF11): uma prova ainda
// sem nota das discursivas distorceria média e distribuição. UC12 A2 é atendido assim:
// o que não tem dado suficiente é devolvido como indisponível, com o motivo, em vez de
// aparecer como zero.
import { query } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { regularizarCorrecoes, regularizarCorrecoesDoProfessor } from '../correcao/correcao.service.js';
// A aritmética do desempenho mora no domínio: é a mesma que o estudante lê no resultado
// da prova, e escrevê-la duas vezes já produziu regras diferentes para o mesmo número.
import {
  arredondar,
  destaques,
  distribuirPorFaixa as distribuir,
  indiceDeAcerto,
  resumoDasNotas as estatisticas,
} from '../../dominio/estatisticas.js';

// --------------------------------------------------------- o que dá para analisar

// UC12, passo 2: as turmas e avaliações do professor disponíveis para análise.
// `turmaId` recorta as avaliações às daquela turma (item 4 do feedback).
//
// Sem ele, entrar pelo painel de uma turma e trocar para "por avaliação" oferecia provas
// de TODAS as turmas do professor — o contexto se perdia em silêncio, e a tela deixava de
// responder à pergunta que foi feita ao entrar. Não era falha de permissão (são provas do
// próprio professor), e sim de recorte.
export async function listarFontes(professorId, { turmaId = null } = {}) {
  // Sem isto, uma prova entregue antes da correção automática existir seria contada como
  // "sem prova corrigida" na hora de escolher o que analisar.
  await regularizarCorrecoesDoProfessor(professorId);

  const { rows: avaliacoes } = await query(
    `SELECT a.id, a.titulo, a.status, a.data_fim,
            (SELECT count(*)::int FROM tentativa t WHERE t.avaliacao_id = a.id) AS total_tentativas,
            (SELECT count(*)::int FROM tentativa t WHERE t.avaliacao_id = a.id AND t.correcao_concluida) AS corrigidas
       FROM avaliacao a
      WHERE a.professor_id = $1 AND a.status <> 'EXCLUIDA'
        ${turmaId ? 'AND EXISTS (SELECT 1 FROM avaliacao_turma at WHERE at.avaliacao_id = a.id AND at.turma_id = $2)' : ''}
      ORDER BY a.data_fim DESC, a.id DESC`,
    turmaId ? [professorId, turmaId] : [professorId],
  );

  const { rows: turmas } = await query(
    `SELECT t.id, t.nome, t.situacao,
            (SELECT count(*)::int FROM turma_estudante te WHERE te.turma_id = t.id AND te.situacao = 'APROVADA') AS total_estudantes,
            (SELECT count(*)::int FROM avaliacao_turma at JOIN avaliacao a ON a.id = at.avaliacao_id
              WHERE at.turma_id = t.id AND a.status <> 'EXCLUIDA') AS total_avaliacoes
       FROM turma t
      WHERE t.professor_id = $1
      ORDER BY lower(t.nome)`,
    [professorId],
  );

  return {
    avaliacoes: avaliacoes.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      status: a.status,
      dataFim: a.data_fim,
      totalTentativas: a.total_tentativas,
      corrigidas: a.corrigidas,
      // Sem prova corrigida não há indicador para mostrar (UC12 A2).
      temDados: a.corrigidas > 0,
    })),
    turmas: turmas.map((t) => ({
      id: t.id,
      nome: t.nome,
      situacao: t.situacao,
      totalEstudantes: t.total_estudantes,
      totalAvaliacoes: t.total_avaliacoes,
    })),
  };
}

// ------------------------------------------------------------ painel da avaliação

export async function daAvaliacao(avaliacaoId, professorId, { turmaId = null } = {}) {
  const { rows: avaliacoes } = await query(
    `SELECT a.id, a.titulo, a.status, a.resultados_liberados,
            (SELECT coalesce(sum(pontuacao), 0) FROM avaliacao_questao WHERE avaliacao_id = a.id) AS pontuacao_maxima
       FROM avaliacao a
      WHERE a.id = $1 AND a.professor_id = $2 AND a.status <> 'EXCLUIDA'`,
    [avaliacaoId, professorId],
  );
  if (!avaliacoes[0]) throw new ErroApp(404, 'Avaliação não encontrada.');
  const avaliacao = avaliacoes[0];

  // Provas entregues antes da correção automática existir ficariam de fora dos
  // indicadores, e o professor leria "nenhuma prova corrigida" numa avaliação só de
  // objetivas, que não depende dele. Rotina idempotente, a mesma da tela de correção.
  await regularizarCorrecoes(avaliacaoId);
  const maxima = Number(avaliacao.pontuacao_maxima);

  // O filtro por turma só vale para turma do próprio professor.
  let turma = null;
  if (turmaId) {
    const { rows } = await query('SELECT id, nome FROM turma WHERE id = $1 AND professor_id = $2', [turmaId, professorId]);
    if (!rows[0]) throw new ErroApp(404, 'Turma não encontrada.');
    turma = rows[0];
  }

  // A prova conta na turma em que foi feita. Isso importa quando a mesma avaliação foi
  // aplicada a duas turmas e o estudante participa das duas: sem isso ele apareceria nos
  // dois recortes. As provas anteriores ao registro da turma (turma_id nulo) continuam
  // valendo pelo vínculo atual, senão sumiriam do painel.
  const filtroTurma = turmaId
    ? `AND (t.turma_id = $2 OR (t.turma_id IS NULL AND EXISTS (
             SELECT 1 FROM turma_estudante te
              WHERE te.turma_id = $2 AND te.estudante_id = t.estudante_id AND te.situacao = 'APROVADA')))`
    : '';
  const parametros = turmaId ? [avaliacaoId, turmaId] : [avaliacaoId];

  const { rows: tentativas } = await query(
    `SELECT t.id, t.status, t.correcao_concluida, t.pontuacao_total, t.pontuacao_objetiva, u.id AS estudante_id, u.nome
       FROM tentativa t JOIN usuario u ON u.id = t.estudante_id
      WHERE t.avaliacao_id = $1 ${filtroTurma}
      ORDER BY lower(u.nome)`,
    parametros,
  );

  const corrigidas = tentativas.filter((t) => t.correcao_concluida && t.pontuacao_total !== null);
  const notas = corrigidas.map((t) => Number(t.pontuacao_total));
  const resumo = estatisticas(notas);
  const percentuais = maxima > 0 ? notas.map((n) => (n / maxima) * 100) : [];

  // Estudantes abaixo da média (UC12, passo 8).
  const abaixoDaMedia = resumo
    ? corrigidas
        .filter((t) => Number(t.pontuacao_total) < resumo.media)
        .map((t) => ({
          estudanteId: t.estudante_id,
          nome: t.nome,
          nota: Number(t.pontuacao_total),
          percentual: maxima > 0 ? arredondar((Number(t.pontuacao_total) / maxima) * 100, 1) : null,
        }))
        .sort((a, b) => a.nota - b.nota)
    : [];

  // Índice de acerto por questão (P-14):
  //   objetiva  → % de provas que acertaram;
  //   discursiva → média da nota obtida ÷ pontuação da questão.
  // `provas` são só as corrigidas; quem não respondeu conta como não acertou.
  const { rows: porQuestao } = await query(
    `WITH provas AS (
       SELECT t.id FROM tentativa t
        WHERE t.avaliacao_id = $1 AND t.correcao_concluida ${filtroTurma}
     )
     SELECT aq.questao_id, aq.ordem, aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.multiplas_corretas, q.multiplas_corretas, FALSE) AS multiplas_corretas,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            (SELECT count(*)::int FROM provas) AS total_provas,
            count(*) FILTER (WHERE r.correta)::int AS acertos,
            count(*) FILTER (WHERE r.id IS NOT NULL)::int AS respondidas,
            coalesce(sum(r.nota_final), 0) AS soma_notas
       FROM avaliacao_questao aq
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN provas p ON TRUE
       LEFT JOIN resposta r ON r.tentativa_id = p.id AND r.questao_id = aq.questao_id
      WHERE aq.avaliacao_id = $1
      GROUP BY aq.questao_id, aq.ordem, aq.pontuacao, aq.tipo, q.tipo, aq.enunciado, q.enunciado,
               aq.multiplas_corretas, q.multiplas_corretas
      ORDER BY aq.ordem`,
    parametros,
  );

  const questoes = porQuestao.map((q) => {
    const totalProvas = q.total_provas;
    const indice = indiceDeAcerto({
      tipo: q.tipo,
      acertos: q.acertos,
      totalProvas,
      somaNotas: q.soma_notas,
      pontuacao: q.pontuacao,
      multiplasCorretas: q.multiplas_corretas,
    });
    return {
      questaoId: q.questao_id,
      ordem: q.ordem,
      tipo: q.tipo,
      enunciado: q.enunciado,
      pontuacao: Number(q.pontuacao),
      totalProvas,
      acertos: q.tipo === 'OBJETIVA' ? q.acertos : null,
      semResposta: totalProvas - q.respondidas,
      // Percentual de aproveitamento: quanto a turma rendeu naquela questão.
      indiceAcerto: indice,
    };
  });

  // DT60: a mesma questão não aparece nos dois destaques. A regra é do domínio, então
  // vale igual aqui e no resultado que o estudante vê.
  const { maioresAcertos, maioresErros } = destaques(questoes);

  return {
    avaliacao: {
      id: avaliacao.id,
      titulo: avaliacao.titulo,
      status: avaliacao.status,
      resultadosLiberados: avaliacao.resultados_liberados,
      pontuacaoMaxima: maxima,
    },
    turma,
    participacao: {
      tentativas: tentativas.length,
      emAndamento: tentativas.filter((t) => t.status === 'EM_ANDAMENTO').length,
      encerradas: tentativas.filter((t) => t.status !== 'EM_ANDAMENTO').length,
      corrigidas: corrigidas.length,
      aguardandoCorrecao: tentativas.filter((t) => t.status !== 'EM_ANDAMENTO' && !t.correcao_concluida).length,
    },
    // UC12 A2: sem prova corrigida, os indicadores ficam indisponíveis, com o motivo.
    temDados: corrigidas.length > 0,
    motivoSemDados:
      corrigidas.length > 0
        ? null
        : tentativas.length === 0
          ? // Com filtro de turma, "ninguém realizou" seria falso: outros estudantes
            // podem ter feito a prova, só não os desta turma.
            turma
            ? `Ninguém da turma ${turma.nome} realizou esta avaliação ainda.`
            : 'Ninguém realizou esta avaliação ainda.'
          : 'Nenhuma prova teve a correção concluída. Corrija as discursivas para ver os indicadores.',
    resumo: resumo
      ? {
          ...resumo,
          mediaPercentual: maxima > 0 ? arredondar((resumo.media / maxima) * 100, 1) : null,
          pontuacaoMaxima: maxima,
        }
      : null,
    distribuicao: corrigidas.length > 0 ? distribuir(percentuais) : [],
    // Todos os estudantes que fizeram ESTA prova, com a nota de cada um — não só os que
    // ficaram abaixo da média. A tela destaca quem está longe dela nos dois sentidos, e
    // para isso precisa da lista inteira, não de um recorte.
    estudantes: tentativas.map((t) => ({
      estudanteId: t.estudante_id,
      // A tela usa isto para levar direto à prova do estudante NESTA avaliação — que é
      // o detalhe que falta a quem está olhando os números dela.
      tentativaId: t.id,
      nome: t.nome,
      // Prova em andamento ou sem correção concluída ainda não tem nota: `null` diz
      // "não dá para saber", que é diferente de zero.
      nota: t.correcao_concluida && t.pontuacao_total !== null ? Number(t.pontuacao_total) : null,
      percentual:
        t.correcao_concluida && t.pontuacao_total !== null && maxima > 0
          ? arredondar((Number(t.pontuacao_total) / maxima) * 100, 1)
          : null,
      emAndamento: t.status === 'EM_ANDAMENTO',
    })),
    abaixoDaMedia,
    questoes,
    // UC12, passos 9 e 10 — as três melhores e as três piores, quando há dados.
    maioresAcertos,
    maioresErros,
  };
}

// ---------------------------------------------------------------- painel da turma

export async function daTurma(turmaId, professorId) {
  const { rows } = await query(
    `SELECT t.id, t.nome, t.situacao,
            (SELECT count(*)::int FROM turma_estudante te WHERE te.turma_id = t.id AND te.situacao = 'APROVADA') AS total_estudantes
       FROM turma t WHERE t.id = $1 AND t.professor_id = $2`,
    [turmaId, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, 'Turma não encontrada.');
  const turma = rows[0];
  await regularizarCorrecoesDoProfessor(professorId);

  // Uma linha por avaliação vinculada, com as notas dos estudantes DESTA turma.
  const { rows: avaliacoes } = await query(
    `SELECT a.id, a.titulo, a.status, a.data_fim,
            (SELECT coalesce(sum(pontuacao), 0) FROM avaliacao_questao WHERE avaliacao_id = a.id) AS pontuacao_maxima,
            count(t.id)::int AS tentativas,
            count(t.id) FILTER (WHERE t.correcao_concluida)::int AS corrigidas,
            avg(t.pontuacao_total) FILTER (WHERE t.correcao_concluida) AS media
       FROM avaliacao_turma at
       JOIN avaliacao a ON a.id = at.avaliacao_id AND a.status <> 'EXCLUIDA'
       LEFT JOIN tentativa t ON t.avaliacao_id = a.id
        AND (t.turma_id = $1 OR (t.turma_id IS NULL AND EXISTS (
              SELECT 1 FROM turma_estudante te
               WHERE te.turma_id = $1 AND te.estudante_id = t.estudante_id AND te.situacao = 'APROVADA')))
      WHERE at.turma_id = $1
      GROUP BY a.id, a.titulo, a.status, a.data_fim
      ORDER BY a.data_fim DESC, a.id DESC`,
    [turmaId],
  );

  // Desempenho de cada estudante ao longo das avaliações da turma, em percentual —
  // avaliações com pontuações diferentes só são comparáveis assim.
  const { rows: porEstudante } = await query(
    `SELECT u.id, u.nome,
            count(t.id) FILTER (WHERE t.correcao_concluida)::int AS provas,
            avg(t.pontuacao_total * 100.0 / NULLIF(
              (SELECT sum(pontuacao) FROM avaliacao_questao WHERE avaliacao_id = t.avaliacao_id), 0))
              FILTER (WHERE t.correcao_concluida) AS media_percentual
       FROM turma_estudante te
       JOIN usuario u ON u.id = te.estudante_id
       LEFT JOIN tentativa t ON t.estudante_id = u.id
        AND t.avaliacao_id IN (SELECT avaliacao_id FROM avaliacao_turma WHERE turma_id = $1)
        AND (t.turma_id IS NULL OR t.turma_id = $1)
      WHERE te.turma_id = $1 AND te.situacao = 'APROVADA'
      GROUP BY u.id, u.nome
      ORDER BY lower(u.nome)`,
    [turmaId],
  );

  const comNota = porEstudante.filter((e) => e.media_percentual !== null);
  const percentuais = comNota.map((e) => Number(e.media_percentual));
  const resumo = estatisticas(percentuais);

  const lista = porEstudante.map((e) => ({
    estudanteId: e.id,
    nome: e.nome,
    provasCorrigidas: e.provas,
    mediaPercentual: e.media_percentual === null ? null : arredondar(Number(e.media_percentual), 1),
  }));

  return {
    turma: { id: turma.id, nome: turma.nome, situacao: turma.situacao, totalEstudantes: turma.total_estudantes },
    // UC12 A1: turma sem avaliação realizada.
    temDados: comNota.length > 0,
    motivoSemDados:
      comNota.length > 0
        ? null
        : avaliacoes.length === 0
          ? 'Esta turma ainda não tem avaliações vinculadas.'
          : 'Ainda não existem provas corrigidas nesta turma.',
    // Quando TODAS as avaliações da turma valem o mesmo, o percentual pode voltar a ser
    // ponto sem perder exatidão: com denominadores iguais, a média dos percentuais é a
    // média das notas dividida pela máxima. "6,8 de 10" diz mais a um professor do que
    // "68%", e é o mesmo número.
    //
    // Com pontuações diferentes a conversão seria mentira — não existe "a nota" comum a
    // uma prova de 10 e outra de 100 —, e aí o percentual é o único denominador honesto.
    escala: (() => {
      const maximas = [...new Set(avaliacoes.map((a) => Number(a.pontuacao_maxima)))];
      return maximas.length === 1 && maximas[0] > 0 ? { pontuacaoMaxima: maximas[0] } : { pontuacaoMaxima: null };
    })(),
    resumo: resumo ? { ...resumo, unidade: 'percentual' } : null,
    distribuicao: comNota.length > 0 ? distribuir(percentuais) : [],
    // "Abaixo da média" aqui é em relação à média da própria turma.
    abaixoDaMedia: resumo
      ? lista
          .filter((e) => e.mediaPercentual !== null && e.mediaPercentual < resumo.media)
          .sort((a, b) => a.mediaPercentual - b.mediaPercentual)
      : [],
    estudantes: lista,
    avaliacoes: avaliacoes.map((a) => {
      const maxima = Number(a.pontuacao_maxima);
      return {
        id: a.id,
        titulo: a.titulo,
        status: a.status,
        dataFim: a.data_fim,
        pontuacaoMaxima: maxima,
        tentativas: a.tentativas,
        corrigidas: a.corrigidas,
        media: a.media === null ? null : arredondar(Number(a.media)),
        mediaPercentual: a.media === null || maxima === 0 ? null : arredondar((Number(a.media) / maxima) * 100, 1),
        // Participação: quantos da turma fizeram, entre os estudantes aprovados nela.
        participacao: turma.total_estudantes > 0 ? arredondar((a.tentativas / turma.total_estudantes) * 100, 1) : null,
      };
    }),
  };
}
