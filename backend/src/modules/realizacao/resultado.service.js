// RF13 (estendido) — o resultado da prova como o **estudante** o vê.
//
// Decisão do autor em 24/09/2026: ao liberar os resultados, o professor escolhe por
// avaliação o que sai além da nota — gabarito, média da turma, distribuição e questões
// em destaque. O padrão é nada além da nota.
//
// Três regras atravessam este módulo:
//
//   1. **Nada sem liberação (P-07).** Sem `resultados_liberados`, a API não devolve nota,
//      gabarito nem indicador nenhum — esconder na tela não protegeria coisa alguma.
//   2. **O grupo é anônimo.** Média, distribuição e destaques nunca trazem nome, e-mail
//      ou nota de outro estudante. E só aparecem a partir de `MINIMO_PARA_AGREGADO`
//      provas corrigidas: em turma pequena, "média da turma" identifica as pessoas por
//      dedução.
//   2b. **O grupo é a turma do estudante** (decisão do autor em 24/09/2026): a prova
//      registra a turma em que foi feita (migração 006) e o agregado se restringe a ela,
//      nunca misturando turmas que receberam a mesma avaliação. Sem turma registrada —
//      avaliação pública feita fora de turma —, a comparação usa todas as provas.
//      A resposta não manda nome de turma nem quantidade de provas: o estudante compara
//      o desempenho, não conta quem fez.
//   3. **O que vale é a prova aplicada.** Enunciados e alternativas vêm da cópia
//      congelada (P-22), não do banco de questões, que pode ter mudado depois.
import { query } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { materializarAusentesDaAvaliacao } from '../correcao/correcao.service.js';
import {
  arredondar,
  destaques,
  distribuirPorFaixa,
  faixaDe,
  indiceDeAcerto,
  percentualDe,
} from '../../dominio/estatisticas.js';

const NAO_DISPONIVEL = 'Resultado não disponível para esta avaliação.';

// Piso de anonimato: com menos provas corrigidas do que isto, um agregado permitiria
// deduzir a nota alheia, então ele simplesmente não é enviado.
export const MINIMO_PARA_AGREGADO = 5;

export async function doEstudante(avaliacaoId, estudanteId) {
  // Quem deixou o prazo passar sem abrir a prova tem a dele registrada em branco aqui
  // (migração 014). Antes desta linha, o `JOIN` abaixo não achava tentativa nenhuma e a
  // resposta era 404: o aluno que faltou era o único da turma que não via nem o gabarito
  // depois de liberado.
  await materializarAusentesDaAvaliacao(avaliacaoId);

  // A tentativa do próprio estudante, com a avaliação e as opções de divulgação.
  const { rows } = await query(
    `SELECT a.id, a.titulo, a.descricao, a.resultados_liberados,
            a.mostrar_gabarito, a.mostrar_media_turma, a.mostrar_distribuicao, a.mostrar_questoes_destaque,
            (SELECT coalesce(sum(pontuacao), 0) FROM avaliacao_questao WHERE avaliacao_id = a.id) AS pontuacao_maxima,
            t.id AS tentativa_id, t.status, t.finalizada_em, t.pontuacao_total, t.pontuacao_objetiva,
            t.correcao_concluida, t.turma_id, t.visualizado_em
       FROM avaliacao a
       JOIN tentativa t ON t.avaliacao_id = a.id AND t.estudante_id = $2
      WHERE a.id = $1 AND a.status <> 'EXCLUIDA'`,
    [avaliacaoId, estudanteId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_DISPONIVEL);
  const linha = rows[0];

  const emAndamento = linha.status === 'EM_ANDAMENTO';
  const liberado = linha.resultados_liberados && linha.correcao_concluida && !emAndamento;
  const maxima = Number(linha.pontuacao_maxima);

  const base = {
    avaliacao: { id: linha.id, titulo: linha.titulo, descricao: linha.descricao },
    tentativa: { situacao: linha.status, finalizadaEm: linha.finalizada_em },
    liberado,
    // O motivo é o que a tela mostra no lugar do resultado; sem isso ela teria de
    // adivinhar por que não há nota.
    naoRealizada: linha.status === 'NAO_REALIZADA',
    motivo: liberado
      ? null
      : emAndamento
        ? 'Esta prova ainda está em andamento.'
        : !linha.correcao_concluida
          ? 'A correção desta prova ainda não foi concluída pelo professor.'
          : 'O professor ainda não liberou os resultados desta avaliação.',
  };
  if (!liberado) return base;

  // A partir daqui o resultado ESTÁ liberado e é isto que a tela vai mostrar: é o
  // momento em que "o estudante viu a nota" passa a ser verdade (migração 015), e o
  // aviso do sino pode parar de aparecer.
  //
  // Uma leitura que grava, o que normalmente seria evitável — mas a alternativa seria um
  // POST disparado pela tela ao renderizar, que diz a mesma coisa com mais partes e uma
  // chance a mais de dessincronizar. Só grava na primeira vez, e nada depende da ordem.
  if (!linha.visualizado_em) {
    await query('UPDATE tentativa SET visualizado_em = now() WHERE id = $1 AND visualizado_em IS NULL', [
      linha.tentativa_id,
    ]);
  }

  const nota = Number(linha.pontuacao_total);
  const resultado = {
    ...base,
    nota: {
      pontos: nota,
      pontuacaoMaxima: maxima,
      percentual: percentualDe(nota, maxima),
    },
  };

  // ----------------------------------------------------------- gabarito (opcional)
  if (linha.mostrar_gabarito) {
    resultado.questoes = await questoesComGabarito(avaliacaoId, linha.tentativa_id);
  }

  // ------------------------------------------- agregados da turma (opcionais, anônimos)
  const querAlgumAgregado =
    linha.mostrar_media_turma || linha.mostrar_distribuicao || linha.mostrar_questoes_destaque;
  if (!querAlgumAgregado) return resultado;

  // O recorte da comparação: a turma em que esta prova foi feita. Sem turma, todas as
  // provas da avaliação — é o caso da avaliação pública feita fora de turma.
  const turmaId = linha.turma_id;
  const { rows: corrigidas } = await query(
    `SELECT pontuacao_total FROM tentativa
      WHERE avaliacao_id = $1 AND correcao_concluida AND pontuacao_total IS NOT NULL
        AND ($2::int IS NULL OR turma_id = $2)`,
    [avaliacaoId, turmaId],
  );
  const totalCorrigidas = corrigidas.length;

  resultado.comparacao = {
    // Só isto: a tela precisa saber se mostra os indicadores ou a explicação da ausência.
    // Quantas provas existem e de quem elas são não é assunto do estudante.
    suficiente: totalCorrigidas >= MINIMO_PARA_AGREGADO,
  };
  if (!resultado.comparacao.suficiente) return resultado;

  const notas = corrigidas.map((t) => Number(t.pontuacao_total));
  if (linha.mostrar_media_turma) {
    const soma = notas.reduce((total, n) => total + n, 0);
    resultado.comparacao.media = arredondar(soma / notas.length);
    resultado.comparacao.mediaPercentual = percentualDe(resultado.comparacao.media, maxima);
  }

  if (linha.mostrar_distribuicao && maxima > 0) {
    const percentuais = notas.map((n) => (n / maxima) * 100);
    resultado.comparacao.distribuicao = distribuirPorFaixa(percentuais);
    // Em qual faixa o próprio estudante caiu — é o que dá sentido ao gráfico para ele.
    resultado.comparacao.minhaFaixa = faixaDe((nota / maxima) * 100);
  }

  if (linha.mostrar_questoes_destaque) {
    resultado.comparacao.destaques = await desempenhoPorQuestao(avaliacaoId, turmaId);
  }

  return resultado;
}

// A prova como o estudante a respondeu: questões na ordem, a resposta dele e o que era
// esperado. Vem da cópia congelada (P-22).
async function questoesComGabarito(avaliacaoId, tentativaId) {
  const { rows: questoes } = await query(
    `SELECT aq.questao_id, aq.ordem, aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            COALESCE(aq.resposta_esperada, q.resposta_esperada) AS resposta_esperada,
            COALESCE(aq.criterios_correcao, q.criterios_correcao) AS criterios_correcao,
            COALESCE(r.avaliacao_alternativa_id, r.alternativa_id) AS alternativa_marcada,
            -- P-26: numa questão de múltipla escolha a marcação é um conjunto. A coluna
            -- acima continua servindo a resposta única; esta traz o conjunto, vazio quando
            -- a questão não é de múltipla escolha.
            (SELECT coalesce(array_agg(coalesce(ra.avaliacao_alternativa_id, ra.alternativa_id)), ARRAY[]::int[])
               FROM resposta_alternativa ra WHERE ra.resposta_id = r.id) AS alternativas_marcadas,
            r.texto, r.correta, r.nota_final, r.feedback_professor
       FROM avaliacao_questao aq
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN resposta r ON r.questao_id = aq.questao_id AND r.tentativa_id = $2
      WHERE aq.avaliacao_id = $1
      ORDER BY aq.ordem`,
    [avaliacaoId, tentativaId],
  );

  const { rows: alternativas } = await query(
    `SELECT ea.id, ea.questao_id, ea.ordem, ea.texto, ea.correta
       FROM avaliacao_alternativa ea WHERE ea.avaliacao_id = $1
     UNION ALL
     SELECT al.id, al.questao_id, al.ordem, al.texto, al.correta
       FROM alternativa al JOIN avaliacao_questao aq ON aq.questao_id = al.questao_id
      WHERE aq.avaliacao_id = $1 AND aq.congelada_em IS NULL
      ORDER BY questao_id, ordem`,
    [avaliacaoId],
  );

  return questoes.map((q) => ({
    questaoId: q.questao_id,
    ordem: q.ordem,
    tipo: q.tipo,
    enunciado: q.enunciado,
    pontuacao: q.pontuacao,
    notaObtida: q.nota_final === null ? null : Number(q.nota_final),
    correta: q.correta,
    // P-26: na questão de múltipla escolha a marcação é um conjunto, e não a coluna
    // única. Sem olhar os dois, a prova respondida aparecia como "sem resposta".
    respondida:
      q.tipo === 'OBJETIVA'
        ? q.alternativa_marcada !== null || (q.alternativas_marcadas ?? []).length > 0
        : Boolean(q.texto?.trim()),
    alternativaMarcada: q.alternativa_marcada,
    alternativasMarcadas: q.alternativas_marcadas ?? [],
    alternativas:
      q.tipo === 'OBJETIVA'
        ? alternativas
            .filter((a) => a.questao_id === q.questao_id)
            .map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto, correta: a.correta }))
        : [],
    minhaResposta: q.tipo === 'DISCURSIVA' ? q.texto : null,
    respostaEsperada: q.tipo === 'DISCURSIVA' ? q.resposta_esperada : null,
    criteriosCorrecao: q.tipo === 'DISCURSIVA' ? q.criterios_correcao : null,
    feedback: q.feedback_professor,
  }));
}

// Questões que a turma mais acertou e mais errou, em percentual — sem nome de ninguém.
// Mesmo cálculo do dashboard do professor (P-14), para os dois lerem o mesmo número.
async function desempenhoPorQuestao(avaliacaoId, turmaId) {
  const { rows } = await query(
    `WITH provas AS (
       SELECT t.id FROM tentativa t
        WHERE t.avaliacao_id = $1 AND t.correcao_concluida
          AND ($2::int IS NULL OR t.turma_id = $2)
     )
     SELECT aq.questao_id, aq.ordem, aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            (SELECT count(*)::int FROM provas) AS total_provas,
            count(*) FILTER (WHERE r.correta)::int AS acertos,
            coalesce(sum(r.nota_final), 0) AS soma_notas
       FROM avaliacao_questao aq
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN provas p ON TRUE
       LEFT JOIN resposta r ON r.tentativa_id = p.id AND r.questao_id = aq.questao_id
      WHERE aq.avaliacao_id = $1
      GROUP BY aq.questao_id, aq.ordem, aq.pontuacao, aq.tipo, q.tipo, aq.enunciado, q.enunciado
      ORDER BY aq.ordem`,
    [avaliacaoId, turmaId],
  );

  const questoes = rows
    .map((q) => ({
      questaoId: q.questao_id,
      ordem: q.ordem,
      enunciado: q.enunciado,
      indiceAcerto: indiceDeAcerto({
        tipo: q.tipo,
        acertos: q.acertos,
        totalProvas: q.total_provas,
        somaNotas: q.soma_notas,
        pontuacao: q.pontuacao,
      }),
    }))
    .filter((q) => q.indiceAcerto !== null);

  // Mesma regra do painel do professor (DT60), vinda do mesmo lugar.
  return { todas: questoes, ...destaques(questoes) };
}
