// RF11 (parcial) — Corrigir e Auxiliar na Correção (UC11), **sem IA** (DT17).
//
// Escopo desta etapa, definido pelo autor em 22/09/2026:
//   - objetivas: corrigidas automaticamente pelo sistema, comparando a alternativa
//     marcada com o gabarito; sem resposta vale 0 (P-12);
//   - discursivas: nota e feedback dados **à mão pelo professor** (P-08, RN04);
//   - a nota do estudante só aparece depois que o professor **libera os resultados**
//     (P-07), por ação explícita.
//
// Nenhuma resposta é apagada: corrigir preenche `correta`, `nota_final`,
// `feedback_professor`, `corrigida_por` e `corrigida_em` na linha que já existe.
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { sugerirNota } from '../../servicos/ia/ia.service.js';
// RF10 entra na mesma tabela da correção (item 9 do feedback): são os mesmos estudantes,
// com colunas diferentes. A lista de tipos vem do domínio, e não do módulo de
// monitoramento, porque aquele já importa este — e duplicar a lista criaria duas noções
// do que é uma "ocorrência".
import { CONTAM_PARA_O_LIMITE } from '../../dominio/monitoramento.js';

const NAO_ENCONTRADA = 'Avaliação não encontrada.';
const TENTATIVA_NAO_ENCONTRADA = 'Prova não encontrada nesta avaliação.';

// Tentativa aberta ainda não se corrige; as demais sim — inclusive a encerrada por
// tempo, que tem respostas válidas como qualquer outra.
// 'NAO_REALIZADA' entra aqui porque, para tudo o que vem depois, ela é uma prova
// encerrada como as outras: conta nas médias, aparece na correção e não impede a
// liberação dos resultados. O que a distingue é a história — ninguém a fez.
export const ENCERRADAS = ['FINALIZADA', 'TEMPO_ESGOTADO', 'BLOQUEADA', 'NAO_REALIZADA'];

async function carregarAvaliacao(executor, avaliacaoId, professorId) {
  const { rows } = await executor.query(
    `SELECT a.id, a.titulo, a.status, a.resultados_liberados, a.monitoramento_ativo,
            (SELECT coalesce(sum(pontuacao), 0) FROM avaliacao_questao WHERE avaliacao_id = a.id) AS pontuacao_total
       FROM avaliacao a
      WHERE a.id = $1 AND a.professor_id = $2 AND a.status <> 'EXCLUIDA'`,
    [avaliacaoId, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
  return rows[0];
}

// ------------------------------------------------- correção automática das objetivas

// Roda quando a tentativa é encerrada e, por segurança, também ao abrir a correção
// (tentativas encerradas antes desta funcionalidade existir nunca passaram por aqui).
// Idempotente: reprocessar não muda o resultado.
export async function corrigirObjetivas(client, tentativaId) {
  // São duas correções, porque são duas regras: a objetiva de resposta única acerta ou
  // erra, e a de múltipla escolha tem nota parcial (P-26). A primeira roda abaixo; a
  // segunda, logo em seguida.
  //
  // `correta` compara a alternativa marcada com a única correta da questão.
  // `nota_final` recebe a pontuação da questão NAQUELA avaliação, não a padrão.
  // O PostgreSQL não permite citar a tabela alvo (`r`) dentro do FROM, então o gabarito
  // de cada objetiva da avaliação vem de uma subconsulta e o confronto acontece no SET.
  // O gabarito vem da cópia congelada na prova (migração 004): é o que o estudante viu.
  // A comparação aceita as duas origens porque o modo teste do professor roda em prova
  // não congelada, onde a alternativa ainda é a do banco.
  await client.query(
    `UPDATE resposta r
        SET correta = (
              (r.avaliacao_alternativa_id IS NOT NULL AND r.avaliacao_alternativa_id = gabarito.correta_congelada)
              OR (r.avaliacao_alternativa_id IS NULL AND r.alternativa_id IS NOT NULL
                  AND r.alternativa_id = gabarito.correta_do_banco)
            ),
            nota_final = CASE WHEN
              (r.avaliacao_alternativa_id IS NOT NULL AND r.avaliacao_alternativa_id = gabarito.correta_congelada)
              OR (r.avaliacao_alternativa_id IS NULL AND r.alternativa_id IS NOT NULL
                  AND r.alternativa_id = gabarito.correta_do_banco)
              THEN gabarito.pontuacao ELSE 0 END,
            corrigida_em = now()
       FROM (
         SELECT aq.questao_id, aq.pontuacao,
                congelada.id AS correta_congelada,
                doBanco.id AS correta_do_banco
           FROM tentativa t
           JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id
           JOIN questao q ON q.id = aq.questao_id
           LEFT JOIN avaliacao_alternativa congelada
                  ON congelada.avaliacao_id = aq.avaliacao_id
                 AND congelada.questao_id = aq.questao_id AND congelada.correta
           LEFT JOIN alternativa doBanco ON doBanco.questao_id = q.id AND doBanco.correta
          WHERE t.id = $1 AND COALESCE(aq.tipo, q.tipo) = 'OBJETIVA'
            AND NOT COALESCE(aq.multiplas_corretas, q.multiplas_corretas, FALSE)
       ) AS gabarito
      WHERE r.tentativa_id = $1 AND r.questao_id = gabarito.questao_id`,
    [tentativaId],
  );

  // P-26 — questão de múltipla escolha, com nota parcial.
  //
  //     nota = máximo(0, (marcadas certas − marcadas erradas) / total de corretas) × pontuação
  //
  // Subtrair as erradas é o que impede marcar tudo e levar nota cheia; o piso em zero
  // impede que errar muito numa questão desconte de outra. `correta` fica verdadeiro só
  // no acerto integral — o parcial aparece na nota, não como acerto.
  //
  // O gabarito vem da cópia congelada quando ela existe, e do banco antes disso (modo
  // teste do professor, P-20). As duas origens são reunidas na mesma subconsulta para
  // que a conta seja uma só.
  await client.query(
    `UPDATE resposta r
        SET nota_final = round(m.proporcao * m.pontuacao, 2),
            correta = (m.proporcao >= 1),
            corrigida_em = now()
       FROM (
         SELECT g.questao_id, g.pontuacao,
                greatest(0, (g.certas - g.erradas)::numeric / nullif(g.total_corretas, 0)) AS proporcao
           FROM (
             SELECT aq.questao_id, aq.pontuacao,
                    -- Sem marcacao nenhuma a juncao nao traz linha, os dois contadores ficam
                    -- em zero e a proporcao da zero: e o que vale deixar em branco (P-12).
                    count(*) FILTER (WHERE coalesce(ea.correta, ab.correta))       AS certas,
                    count(*) FILTER (WHERE NOT coalesce(ea.correta, ab.correta))   AS erradas,
                    (SELECT count(*) FROM avaliacao_alternativa gc
                      WHERE gc.avaliacao_id = aq.avaliacao_id AND gc.questao_id = aq.questao_id AND gc.correta)
                    + (SELECT count(*) FROM alternativa gb
                        WHERE gb.questao_id = aq.questao_id AND gb.correta AND aq.congelada_em IS NULL)
                      AS total_corretas
               FROM tentativa t
               JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id
               JOIN questao q ON q.id = aq.questao_id
               JOIN resposta r2 ON r2.tentativa_id = t.id AND r2.questao_id = aq.questao_id
               LEFT JOIN resposta_alternativa ra ON ra.resposta_id = r2.id
               LEFT JOIN avaliacao_alternativa ea ON ea.id = ra.avaliacao_alternativa_id
               LEFT JOIN alternativa ab ON ab.id = ra.alternativa_id
              WHERE t.id = $1 AND COALESCE(aq.tipo, q.tipo) = 'OBJETIVA'
                AND COALESCE(aq.multiplas_corretas, q.multiplas_corretas, FALSE)
              GROUP BY aq.questao_id, aq.pontuacao, aq.avaliacao_id, aq.congelada_em, r2.id
           ) AS g
       ) AS m
      WHERE r.tentativa_id = $1 AND r.questao_id = m.questao_id`,
    [tentativaId],
  );

  // Objetiva não respondida não tem linha em `resposta` e vale 0 (P-12): por isso a
  // soma percorre só o que existe.
  const { rows } = await client.query(
    `SELECT coalesce(sum(r.nota_final), 0) AS total
       FROM resposta r
       JOIN tentativa t ON t.id = r.tentativa_id
       JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id AND aq.questao_id = r.questao_id
       JOIN questao q ON q.id = r.questao_id
      WHERE r.tentativa_id = $1 AND COALESCE(aq.tipo, q.tipo) = 'OBJETIVA'`,
    [tentativaId],
  );
  await client.query('UPDATE tentativa SET pontuacao_objetiva = $2 WHERE id = $1', [tentativaId, rows[0].total]);
  return rows[0].total;
}

// A correção está concluída quando TODA discursiva da avaliação tem nota. Discursiva
// deixada em branco também precisa de nota (normalmente 0), dada pelo professor.
//
// Também roda na entrega da prova: numa avaliação só de objetivas não há nada para o
// professor corrigir, então ela já sai da entrega com a correção concluída e a nota
// somada — do contrário ficaria "aguardando correção" até alguém abrir a tela.
export async function recalcularTentativa(client, tentativaId) {
  const { rows } = await client.query(
    `SELECT t.status,
       (SELECT count(*)::int FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
         WHERE aq.avaliacao_id = t.avaliacao_id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA') AS total_discursivas,
       (SELECT count(*)::int FROM resposta r
          JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id AND aq.questao_id = r.questao_id
          JOIN questao q ON q.id = r.questao_id
         WHERE r.tentativa_id = t.id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA'
           AND r.nota_final IS NOT NULL) AS discursivas_corrigidas,
       (SELECT coalesce(sum(r.nota_final), 0) FROM resposta r WHERE r.tentativa_id = t.id) AS soma
     FROM tentativa t WHERE t.id = $1`,
    [tentativaId],
  );
  const { total_discursivas: total, discursivas_corrigidas: corrigidas, soma } = rows[0];
  // Prova não realizada já nasce corrigida: não há resposta nenhuma para o professor
  // avaliar. Sem esta linha ela ficaria "aguardando correção" para sempre numa prova com
  // discursivas — e travaria a liberação dos resultados da turma inteira por causa de
  // quem faltou.
  const concluida = rows[0].status === 'NAO_REALIZADA' || corrigidas >= total;

  await client.query(
    // A pontuação total só existe quando a correção terminou: nota parcial confundiria.
    'UPDATE tentativa SET correcao_concluida = $2, pontuacao_total = $3 WHERE id = $1',
    [tentativaId, concluida, concluida ? soma : null],
  );
  return { concluida, pontuacaoTotal: concluida ? soma : null };
}

// --------------------------------------------------------------------- regularização

// Rede de segurança para tentativas encerradas que nunca passaram pela correção
// automática — as entregues antes de a funcionalidade existir. Tudo aqui é idempotente,
// então rodar de novo não altera nota nenhuma. Usada ao abrir a correção e ao abrir o
// dashboard: sem isso a prova apareceria como "aguardando correção" nos dois lugares,
// mesmo não havendo nada para o professor corrigir.
export async function regularizarCorrecoes(avaliacaoId) {
  await materializarAusentes('a.id = $1', [avaliacaoId]);
  await regularizar('t.avaliacao_id = $1', [avaliacaoId]);
}

// Mesma coisa, para todas as avaliações de um professor: é o que o dashboard precisa
// antes de contar quantas provas estão corrigidas em cada uma.
export async function regularizarCorrecoesDoProfessor(professorId) {
  await materializarAusentes('a.professor_id = $1', [professorId]);
  await regularizar('a.professor_id = $1', [professorId]);
}

// A prova de quem não fez vira registro quando o prazo termina (migração 014).
//
// Pelo mesmo mecanismo preguiçoso do resto: o sistema não tem processo em segundo plano,
// então quem abre a correção, o dashboard ou o próprio resultado é que materializa o que
// já era verdade. Idempotente — o `NOT EXISTS` garante uma tentativa por estudante, que
// é a mesma regra do índice único da tabela (P-04).
//
// Três condições, e todas importam:
//   - `data_fim < now()`: com o período aberto, o estudante ainda tem direito de fazer a
//     prova. Entregá-la em branco antes disso seria o sistema desistir por ele;
//   - avaliação PUBLICADA ou ARQUIVADA: rascunho ninguém podia fazer, logo ninguém faltou;
//   - vínculo APROVADA: quem estava pendente ou saiu da turma não devia a prova.
export async function materializarAusentesDaAvaliacao(avaliacaoId) {
  await materializarAusentes('a.id = $1', [avaliacaoId]);
}

async function materializarAusentes(condicao, parametros) {
  await transacao(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tentativa
         (avaliacao_id, estudante_id, iniciada_em, prazo_final, finalizada_em, status, turma_id)
       SELECT a.id, te.estudante_id, a.data_fim, a.data_fim, a.data_fim, 'NAO_REALIZADA', at.turma_id
         FROM avaliacao a
         JOIN avaliacao_turma at ON at.avaliacao_id = a.id
         JOIN turma_estudante te ON te.turma_id = at.turma_id AND te.situacao = 'APROVADA'
        WHERE ${condicao}
          AND a.status IN ('PUBLICADA', 'ARQUIVADA')
          AND a.data_fim < now()
          AND NOT EXISTS (
            SELECT 1 FROM tentativa t WHERE t.avaliacao_id = a.id AND t.estudante_id = te.estudante_id
          )
       RETURNING id`,
      parametros,
    );
    // As horas são todas o prazo da prova, e não "agora": a prova acabou na hora do
    // prazo, não quando alguém reparou nisso — mesma escolha do encerramento por tempo.
    for (const { id } of rows) {
      await corrigirObjetivas(client, id);
      await recalcularTentativa(client, id);
    }
  });
}

async function regularizar(condicao, parametros) {
  await transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT t.id FROM tentativa t
         JOIN avaliacao a ON a.id = t.avaliacao_id
        WHERE ${condicao} AND t.status = ANY($2) AND t.pontuacao_objetiva IS NULL
        FOR UPDATE OF t`,
      [...parametros, ENCERRADAS],
    );
    for (const { id } of rows) {
      await corrigirObjetivas(client, id);
      await recalcularTentativa(client, id);
    }
  });
}

// ------------------------------------------------------------ reabertura (18/10/2026)

// Só a partir da última reabertura é que as ocorrências contam para o limite. Vive aqui
// porque três consultas diferentes precisam da mesma regra, e duas noções de "quantas
// ocorrências" divergiriam na primeira mudança.
//
// `-infinity` quando nunca houve reabertura: assim a condição vale para todo evento, e
// a consulta não precisa de um caminho alternativo.
export const DESDE_A_REABERTURA = `
  COALESCE(
    (SELECT max(r.reaberta_em) FROM reabertura_tentativa r WHERE r.tentativa_id = t.id),
    '-infinity'::timestamptz
  )`;

const MOTIVO_SEM_REABRIR =
  'Os resultados desta avaliação já foram liberados. Reabrir mudaria uma nota que o estudante já viu — ' +
  'se for mesmo necessário, converse com ele antes.';

// Devolve a prova ao estudante com prazo novo.
//
// Não é uma segunda tentativa (P-04): é a mesma, reaberta. As respostas já dadas
// permanecem, e ele continua de onde parou — apagá-las para "zerar" seria exclusão
// física de registro, que a P-02 proíbe.
//
// Nota e correção são desfeitas, porque vão ser recalculadas na nova entrega. O motivo
// do bloqueio é limpo: se a prova foi encerrada pelo monitoramento e volta com o mesmo
// motivo gravado, o estudante leria que está bloqueado enquanto responde.
async function reabrirUma(client, tentativa, professorId, { minutos, motivo }) {
  await client.query(
    `UPDATE tentativa
        SET status = 'EM_ANDAMENTO',
            prazo_final = now() + ($2 || ' minutes')::interval,
            finalizada_em = NULL,
            motivo_bloqueio = NULL,
            correcao_concluida = FALSE,
            pontuacao_total = NULL,
            pontuacao_objetiva = NULL
      WHERE id = $1`,
    [tentativa.id, String(minutos)],
  );
  await client.query(
    `INSERT INTO reabertura_tentativa (tentativa_id, professor_id, minutos, motivo, situacao_anterior)
     VALUES ($1, $2, $3, $4, $5)`,
    [tentativa.id, professorId, minutos, motivo.trim(), tentativa.status],
  );
}

// Uma prova, de um estudante: o caso do computador que travou ou do bloqueio injusto.
export async function reabrirTentativa(avaliacaoId, tentativaId, professorId, dados) {
  await transacao(async (client) => {
    const avaliacao = await carregarAvaliacao(client, avaliacaoId, professorId);
    if (avaliacao.resultados_liberados) throw new ErroApp(409, MOTIVO_SEM_REABRIR);

    const { rows } = await client.query(
      'SELECT id, status FROM tentativa WHERE id = $1 AND avaliacao_id = $2 FOR UPDATE',
      [tentativaId, avaliacaoId],
    );
    if (!rows[0]) throw new ErroApp(404, 'Prova não encontrada.');
    // Devolver é trazer de volta algo que foi encerrado. Prova em andamento já está com
    // o estudante — não há o que devolver, e a tela desabilita o botão pelo mesmo
    // motivo. Quem precisa compensar um incidente que atingiu quem ainda responde usa a
    // devolução em lote, logo abaixo.
    if (rows[0].status === 'EM_ANDAMENTO') {
      throw new ErroApp(409, 'Esta prova está em andamento: não há o que devolver.');
    }
    await reabrirUma(client, rows[0], professorId, dados);
  });
  return listarTentativas(avaliacaoId, professorId);
}

// A turma inteira: o caso da queda de energia na sala.
//
// Estender o `data_fim` da avaliação NÃO resolveria: cada tentativa guarda o próprio
// `prazo_final`, calculado quando o estudante começou, e mexer na data da prova só
// permitiria que novos comecem. Por isso o tempo é devolvido tentativa a tentativa.
//
// Inclui quem ainda está em andamento, diferente da devolução individual: numa queda de
// energia, quem estava respondendo é justamente quem mais perdeu tempo. É a diferença de
// intenção entre as duas ações — uma resgata uma prova encerrada, a outra compensa um
// incidente que atingiu a turma inteira.
export async function reabrirProva(avaliacaoId, professorId, dados) {
  await transacao(async (client) => {
    const avaliacao = await carregarAvaliacao(client, avaliacaoId, professorId);
    if (avaliacao.resultados_liberados) throw new ErroApp(409, MOTIVO_SEM_REABRIR);

    const { rows } = await client.query(
      'SELECT id, status FROM tentativa WHERE avaliacao_id = $1 FOR UPDATE',
      [avaliacaoId],
    );
    if (rows.length === 0) throw new ErroApp(409, 'Ninguém iniciou esta avaliação ainda.');
    for (const tentativa of rows) await reabrirUma(client, tentativa, professorId, dados);
  });
  return listarTentativas(avaliacaoId, professorId);
}

// O histórico de devoluções de uma prova, da mais recente para a mais antiga.
export async function reaberturasDaTentativa(executor, tentativaId) {
  const { rows } = await executor.query(
    `SELECT r.reaberta_em, r.minutos, r.motivo, r.situacao_anterior, u.nome AS professor
       FROM reabertura_tentativa r JOIN usuario u ON u.id = r.professor_id
      WHERE r.tentativa_id = $1 ORDER BY r.reaberta_em DESC`,
    [tentativaId],
  );
  return rows.map((r) => ({
    reabertaEm: r.reaberta_em,
    minutos: r.minutos,
    motivo: r.motivo,
    situacaoAnterior: r.situacao_anterior,
    professor: r.professor,
  }));
}

// ------------------------------------------------------------------------- listagem

// Painel de correção de uma avaliação: uma linha por estudante que fez a prova.
export async function listarTentativas(avaliacaoId, professorId) {
  const avaliacao = await carregarAvaliacao({ query }, avaliacaoId, professorId);
  await regularizarCorrecoes(avaliacaoId);

  const { rows } = await query(
    `SELECT t.id, t.status, t.iniciada_em, t.finalizada_em, t.pontuacao_objetiva, t.pontuacao_total,
            t.correcao_concluida, u.nome, u.email,
            (SELECT count(*)::int FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
              WHERE aq.avaliacao_id = t.avaliacao_id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA') AS total_discursivas,
            (SELECT count(*)::int FROM resposta r
               JOIN avaliacao_questao aq ON aq.avaliacao_id = t.avaliacao_id AND aq.questao_id = r.questao_id
               JOIN questao q ON q.id = r.questao_id
              WHERE r.tentativa_id = t.id AND COALESCE(aq.tipo, q.tipo) = 'DISCURSIVA'
                AND r.nota_final IS NOT NULL) AS discursivas_corrigidas,
            (SELECT count(*)::int FROM evento_monitoramento e
              WHERE e.tentativa_id = t.id AND e.tipo = ANY($2)
                AND e.data_hora > ${DESDE_A_REABERTURA}) AS ocorrencias,
            (SELECT count(*)::int FROM reabertura_tentativa r WHERE r.tentativa_id = t.id) AS reaberturas
       FROM tentativa t JOIN usuario u ON u.id = t.estudante_id
      WHERE t.avaliacao_id = $1
      ORDER BY lower(u.nome)`,
    [avaliacaoId, CONTAM_PARA_O_LIMITE],
  );

  const tentativas = rows.map((t) => ({
    id: t.id,
    estudante: { nome: t.nome, email: t.email },
    status: t.status,
    emAndamento: t.status === 'EM_ANDAMENTO',
    iniciadaEm: t.iniciada_em,
    finalizadaEm: t.finalizada_em,
    pontuacaoObjetiva: t.pontuacao_objetiva,
    pontuacaoTotal: t.pontuacao_total,
    correcaoConcluida: t.correcao_concluida,
    // Quantas ocorrências o navegador registrou nesta prova. Zero é o normal, e a tela
    // deve tratá-lo como tal — o número descreve o que foi observado, não acusa ninguém.
    ocorrencias: t.ocorrencias,
    // Quantas vezes o professor devolveu esta prova. Zero é o normal, e por isso a tela
    // mostra a marca só em quem tem — uma coluna de zeros diria que algo aconteceu com
    // todos, que é o contrário da verdade.
    reaberturas: t.reaberturas,
    totalDiscursivas: t.total_discursivas,
    discursivasCorrigidas: t.discursivas_corrigidas,
    podeCorrigir: ENCERRADAS.includes(t.status),
  }));

  const encerradas = tentativas.filter((t) => t.podeCorrigir);
  const pendentes = encerradas.filter((t) => !t.correcaoConcluida);

  return {
    avaliacao: {
      id: avaliacao.id,
      titulo: avaliacao.titulo,
      status: avaliacao.status,
      pontuacaoTotal: avaliacao.pontuacao_total,
      resultadosLiberados: avaliacao.resultados_liberados,
      // A coluna de ocorrências só faz sentido onde o monitoramento esteve ligado: numa
      // prova sem ele, uma coluna de zeros sugeriria que nada aconteceu, quando na
      // verdade nada foi observado (P-06).
      monitoramentoAtivo: avaliacao.monitoramento_ativo,
    },
    tentativas,
    resumo: {
      total: tentativas.length,
      emAndamento: tentativas.filter((t) => t.emAndamento).length,
      aguardandoCorrecao: pendentes.length,
      corrigidas: encerradas.length - pendentes.length,
      // P-07: só libera com todas as provas encerradas e corrigidas.
      podeLiberar:
        encerradas.length > 0 &&
        pendentes.length === 0 &&
        tentativas.every((t) => !t.emAndamento) &&
        !avaliacao.resultados_liberados,
    },
  };
}

// ---------------------------------------------------------- uma prova para corrigir

export async function detalharTentativa(avaliacaoId, professorId, tentativaId) {
  await carregarAvaliacao({ query }, avaliacaoId, professorId);

  const dados = await transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.status, t.iniciada_em, t.finalizada_em, t.pontuacao_objetiva, t.pontuacao_total,
              t.correcao_concluida, u.nome, u.email
         FROM tentativa t JOIN usuario u ON u.id = t.estudante_id
        WHERE t.id = $1 AND t.avaliacao_id = $2 FOR UPDATE OF t`,
      [tentativaId, avaliacaoId],
    );
    if (!rows[0]) throw new ErroApp(404, TENTATIVA_NAO_ENCONTRADA);
    const tentativa = rows[0];
    if (!ENCERRADAS.includes(tentativa.status)) {
      throw new ErroApp(409, 'Esta prova ainda está em andamento e não pode ser corrigida.');
    }
    if (tentativa.pontuacao_objetiva === null) {
      await corrigirObjetivas(client, tentativaId);
      await recalcularTentativa(client, tentativaId);
      const { rows: atualizada } = await client.query(
        'SELECT pontuacao_objetiva, pontuacao_total, correcao_concluida FROM tentativa WHERE id = $1',
        [tentativaId],
      );
      Object.assign(tentativa, atualizada[0]);
    }
    return tentativa;
  });

  // Uma linha por questão da avaliação, mesmo sem resposta do estudante.
  const { rows: questoes } = await query(
    `SELECT aq.questao_id, aq.ordem, aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.multiplas_corretas, q.multiplas_corretas, FALSE) AS multiplas_corretas,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            COALESCE(aq.resposta_esperada, q.resposta_esperada) AS resposta_esperada,
            COALESCE(aq.criterios_correcao, q.criterios_correcao) AS criterios_correcao,
            COALESCE(r.avaliacao_alternativa_id, r.alternativa_id) AS alternativa_id,
            -- P-26: numa questão de múltipla escolha a marcação é um conjunto. A coluna
            -- acima continua servindo a resposta única; esta traz o conjunto, vazio quando
            -- a questão não é de múltipla escolha.
            (SELECT coalesce(array_agg(coalesce(ra.avaliacao_alternativa_id, ra.alternativa_id)), ARRAY[]::int[])
               FROM resposta_alternativa ra WHERE ra.resposta_id = r.id) AS alternativas_marcadas,
            r.texto, r.correta, r.nota_final, r.feedback_professor, r.corrigida_em,
            r.nota_sugerida_ia, r.justificativa_ia, r.ia_solicitada_em, r.ia_modelo
       FROM avaliacao_questao aq
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN resposta r ON r.questao_id = aq.questao_id AND r.tentativa_id = $2
      WHERE aq.avaliacao_id = $1
      ORDER BY aq.ordem`,
    [avaliacaoId, tentativaId],
  );

  // Alternativas como estavam na prova; nas não congeladas, as do banco.
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

  // RF10 junto da correção (item 9 do feedback): até aqui, o professor que quisesse saber
  // o que o navegador observou durante ESTA prova precisava abrir outra tela e cruzar os
  // nomes à mão. O dado chega junto da decisão que ele informa.
  //
  // P-06 continua valendo com mais força, não menos: o número descreve o que foi
  // observado e não afirma consulta a material externo. A tela precisa dizer isso onde os
  // eventos aparecem — ao lado da nota, o convite a ligar as duas coisas é maior.
  const { rows: eventos } = await query(
    `SELECT id, tipo, detalhe, data_hora, bloqueou_tentativa
       FROM evento_monitoramento WHERE tentativa_id = $1
      ORDER BY data_hora, id`,
    [tentativaId],
  );

  return {
    tentativa: {
      id: dados.id,
      estudante: { nome: dados.nome, email: dados.email },
      status: dados.status,
      iniciadaEm: dados.iniciada_em,
      finalizadaEm: dados.finalizada_em,
      pontuacaoObjetiva: dados.pontuacao_objetiva,
      pontuacaoTotal: dados.pontuacao_total,
      correcaoConcluida: dados.correcao_concluida,
      // O histórico de devoluções desta prova. É aqui que alguém vem entender uma nota
      // estranha, e é aqui que a justificativa do professor precisa estar escrita.
      reaberturas: await reaberturasDaTentativa({ query }, tentativaId),
    },
    monitoramento: {
      ocorrencias: eventos.filter((e) => CONTAM_PARA_O_LIMITE.includes(e.tipo)).length,
      eventos: eventos.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        detalhe: e.detalhe,
        dataHora: e.data_hora,
        bloqueou: e.bloqueou_tentativa,
      })),
    },
    questoes: questoes.map((q) => ({
      questaoId: q.questao_id,
      ordem: q.ordem,
      tipo: q.tipo,
      enunciado: q.enunciado,
      pontuacao: q.pontuacao,
      // P-26: na questão de múltipla escolha a marcação não está em `alternativa_id`, e
      // sim no conjunto. Sem olhar os dois, uma prova respondida aparecia "em branco".
      respondida:
        q.tipo === 'OBJETIVA'
          ? q.alternativa_id !== null || (q.alternativas_marcadas ?? []).length > 0
          : Boolean(q.texto?.trim()),
      // RF11: a sugestão que já tiver sido pedida para esta resposta. É só do professor
      // (P-08) — o estudante nunca recebe estes campos.
      sugestaoIA:
        q.ia_solicitada_em === null || q.ia_solicitada_em === undefined
          ? null
          : {
              nota: q.nota_sugerida_ia === null ? null : Number(q.nota_sugerida_ia),
              justificativa: q.justificativa_ia,
              modelo: q.ia_modelo,
              solicitadaEm: q.ia_solicitada_em,
            },
      // Objetiva: o que o estudante marcou e qual era a correta (o professor vê o gabarito).
      multiplasCorretas: q.multiplas_corretas,
      alternativaMarcada: q.alternativa_id,
      alternativasMarcadas: q.alternativas_marcadas ?? [],
      alternativas:
        q.tipo === 'OBJETIVA'
          ? alternativas
              .filter((a) => a.questao_id === q.questao_id)
              .map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto, correta: a.correta }))
          : [],
      correta: q.correta,
      // Discursiva: resposta do estudante ao lado da referência, para o professor decidir.
      texto: q.texto,
      respostaEsperada: q.tipo === 'DISCURSIVA' ? q.resposta_esperada : null,
      criteriosCorrecao: q.tipo === 'DISCURSIVA' ? q.criterios_correcao : null,
      notaFinal: q.nota_final,
      feedback: q.feedback_professor,
      corrigidaEm: q.corrigida_em,
    })),
  };
}

// --------------------------------------------------- gravar a correção das discursivas

export async function corrigirDiscursivas(avaliacaoId, professorId, tentativaId, correcoes) {
  await carregarAvaliacao({ query }, avaliacaoId, professorId);

  await transacao(async (client) => {
    const { rows } = await client.query(
      'SELECT id, status FROM tentativa WHERE id = $1 AND avaliacao_id = $2 FOR UPDATE',
      [tentativaId, avaliacaoId],
    );
    if (!rows[0]) throw new ErroApp(404, TENTATIVA_NAO_ENCONTRADA);
    if (!ENCERRADAS.includes(rows[0].status)) {
      throw new ErroApp(409, 'Esta prova ainda está em andamento e não pode ser corrigida.');
    }

    const { rows: questoes } = await client.query(
      `SELECT aq.questao_id, aq.pontuacao, COALESCE(aq.tipo, q.tipo) AS tipo
         FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
        WHERE aq.avaliacao_id = $1`,
      [avaliacaoId],
    );
    const porQuestao = new Map(questoes.map((q) => [q.questao_id, q]));

    for (const item of correcoes) {
      const questao = porQuestao.get(item.questaoId);
      if (!questao) throw new ErroApp(400, 'Há questões que não fazem parte desta avaliação.');
      // RF11: a objetiva é corrigida pelo sistema; o professor não dá nota nela.
      if (questao.tipo !== 'DISCURSIVA') {
        throw new ErroApp(400, 'Questões objetivas são corrigidas automaticamente e não recebem nota manual.');
      }
      if (item.nota > Number(questao.pontuacao)) {
        throw new ErroApp(400, `A nota não pode passar de ${questao.pontuacao} nesta questão.`, {
          [`nota.${item.questaoId}`]: `Máximo: ${questao.pontuacao}.`,
        });
      }

      // Discursiva deixada em branco não tem linha em `resposta`: a correção cria a
      // linha com a nota, para que o zero fique registrado (RN06).
      await client.query(
        `INSERT INTO resposta (tentativa_id, questao_id, texto, nota_final, feedback_professor, corrigida_por, corrigida_em)
         VALUES ($1, $2, NULL, $3, $4, $5, now())
         ON CONFLICT (tentativa_id, questao_id)
         DO UPDATE SET nota_final = EXCLUDED.nota_final, feedback_professor = EXCLUDED.feedback_professor,
                       corrigida_por = EXCLUDED.corrigida_por, corrigida_em = now()`,
        [tentativaId, item.questaoId, item.nota, item.feedback ?? null, professorId],
      );
    }

    await recalcularTentativa(client, tentativaId);
  });

  return detalharTentativa(avaliacaoId, professorId, tentativaId);
}

// ------------------------------------------------------- liberar resultados (P-07)

// RF11 / UC11 — pede à IA uma sugestão de nota para uma resposta discursiva.
//
// A sugestão é **gravada** (não só devolvida) para que o professor possa sair da tela e
// voltar sem gastar outra chamada — e para que fique registrado que houve auxílio de IA
// naquela correção, com o modelo que a produziu.
//
// O que esta função NUNCA faz: atribuir a nota. `nota_final` não é tocada aqui. Quem
// decide é o professor (RN04, P-08).
export async function sugerirNotaDaResposta(avaliacaoId, tentativaId, questaoId, professorId) {
  // Carrega tudo o que é preciso e, no mesmo passo, confere a propriedade: avaliação do
  // professor, tentativa daquela avaliação, questão daquela prova.
  const { rows } = await query(
    `SELECT t.status,
            aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            COALESCE(aq.resposta_esperada, q.resposta_esperada) AS resposta_esperada,
            COALESCE(aq.criterios_correcao, q.criterios_correcao) AS criterios_correcao,
            -- Contexto para a IA: o tema da questão e, na falta dele, o título da prova.
            COALESCE(NULLIF(trim(COALESCE(aq.tema, q.tema)), ''), a.titulo) AS contexto,
            r.id AS resposta_id, r.texto
       FROM tentativa t
       JOIN avaliacao a ON a.id = t.avaliacao_id
       JOIN avaliacao_questao aq ON aq.avaliacao_id = a.id AND aq.questao_id = $3
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN resposta r ON r.tentativa_id = t.id AND r.questao_id = aq.questao_id
      WHERE t.id = $2 AND t.avaliacao_id = $1 AND a.professor_id = $4 AND a.status <> 'EXCLUIDA'`,
    [avaliacaoId, tentativaId, questaoId, professorId],
  );
  const dados = rows[0];
  if (!dados) throw new ErroApp(404, 'Questão não encontrada nesta prova.');

  // A IA corrige discursiva; objetiva já é corrigida pelo gabarito (P-12).
  if (dados.tipo !== 'DISCURSIVA') {
    throw new ErroApp(409, 'A sugestão por IA vale para questões discursivas; as objetivas o sistema já corrige.');
  }
  if (dados.status === 'EM_ANDAMENTO') {
    throw new ErroApp(409, 'Esta prova ainda está em andamento.');
  }
  // UC11 A6: sem conteúdo não há o que analisar — e não se gasta uma chamada para
  // descobrir isso.
  const texto = dados.texto?.trim();
  if (!texto) {
    throw new ErroApp(409, 'Esta questão não tem resposta registrada: não há conteúdo para analisar.');
  }

  const sugestao = await sugerirNota({
    tema: dados.contexto,
    enunciado: dados.enunciado,
    respostaEsperada: dados.resposta_esperada,
    criterios: dados.criterios_correcao,
    pontuacaoMaxima: Number(dados.pontuacao),
    resposta: texto,
  });

  // A resposta existe (há texto), então o UPDATE sempre encontra a linha.
  await query(
    `UPDATE resposta
        SET nota_sugerida_ia = $2, justificativa_ia = $3, ia_modelo = $4, ia_solicitada_em = now()
      WHERE id = $1`,
    [dados.resposta_id, sugestao.nota, sugestao.justificativa, sugestao.modelo],
  );

  return {
    questaoId,
    pontuacaoMaxima: Number(dados.pontuacao),
    sugestao: {
      nota: sugestao.nota,
      justificativa: sugestao.justificativa,
      modelo: sugestao.modelo,
      simulada: sugestao.simulada,
    },
    // Lembrete que a tela repete ao professor: a nota continua sendo dele (RN04).
    notaFinalContinuaSendoDoProfessor: true,
  };
}

// RF11 — sugere a nota de **todas** as discursivas ainda sem sugestão nesta prova.
//
// Decisão do autor (06/10/2026): a correção assistida deixa de ser pedida questão a
// questão e passa a acontecer quando o professor abre a prova. Ele então **aprova** cada
// sugestão ou a **recusa**, caso em que corrige à mão.
//
// A geração continua presa à prova que o professor abriu — e não a todas as provas da
// turma — por dois motivos: só se gasta com o que ele realmente vai corrigir, e o DERS
// pede que o auxílio seja acionado por ele (UC11, passo 11), ainda que agora o
// acionamento seja abrir a tela em vez de clicar em cada questão.
//
// Questões que já têm sugestão não são refeitas: reabrir a prova não gasta de novo.
export async function sugerirNotasPendentes(avaliacaoId, tentativaId, professorId) {
  const { rows: questoes } = await query(
    `SELECT aq.questao_id, aq.pontuacao,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            r.id AS resposta_id, r.texto, r.ia_solicitada_em, r.nota_final
       FROM tentativa t
       JOIN avaliacao a ON a.id = t.avaliacao_id
       JOIN avaliacao_questao aq ON aq.avaliacao_id = a.id
       JOIN questao q ON q.id = aq.questao_id
       LEFT JOIN resposta r ON r.tentativa_id = t.id AND r.questao_id = aq.questao_id
      WHERE t.id = $2 AND t.avaliacao_id = $1 AND a.professor_id = $3 AND a.status <> 'EXCLUIDA'
        AND t.status <> 'EM_ANDAMENTO'
      ORDER BY aq.ordem`,
    [avaliacaoId, tentativaId, professorId],
  );
  if (questoes.length === 0) throw new ErroApp(404, 'Prova não encontrada.');

  const pendentes = questoes.filter(
    (q) =>
      q.tipo === 'DISCURSIVA' &&
      q.texto?.trim() && // sem resposta não há o que analisar (UC11 A6)
      !q.ia_solicitada_em && // já sugerida antes: não gasta de novo
      q.nota_final === null, // já corrigida pelo professor: não precisa de sugestão
  );

  const geradas = [];
  const falhas = [];
  for (const questao of pendentes) {
    try {
      const resultado = await sugerirNotaDaResposta(avaliacaoId, tentativaId, questao.questao_id, professorId);
      geradas.push(resultado);
    } catch (erro) {
      // Uma falha não interrompe as demais: o professor recebe o que deu certo e uma
      // indicação do que não veio, para corrigir essas à mão (UC11 A5).
      falhas.push({ questaoId: questao.questao_id, motivo: erro.mensagem ?? erro.message });
    }
  }

  return { geradas, falhas, totalPendentes: pendentes.length };
}

export async function liberarResultados(avaliacaoId, professorId) {
  await transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT id, resultados_liberados FROM avaliacao
        WHERE id = $1 AND professor_id = $2 AND status <> 'EXCLUIDA' FOR UPDATE`,
      [avaliacaoId, professorId],
    );
    if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
    if (rows[0].resultados_liberados) throw new ErroApp(409, 'Os resultados desta avaliação já foram liberados.');

    const { rows: situacao } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'EM_ANDAMENTO')::int AS em_andamento,
              count(*) FILTER (WHERE status <> 'EM_ANDAMENTO' AND NOT correcao_concluida)::int AS sem_correcao
         FROM tentativa WHERE avaliacao_id = $1`,
      [avaliacaoId],
    );
    const { total, em_andamento: emAndamento, sem_correcao: semCorrecao } = situacao[0];

    // P-07: liberar exige todas as provas encerradas e com a correção concluída.
    if (total === 0) throw new ErroApp(409, 'Nenhum estudante realizou esta avaliação.');
    if (emAndamento > 0) {
      throw new ErroApp(409, `Há ${emAndamento} prova(s) ainda em andamento. Aguarde o encerramento.`);
    }
    if (semCorrecao > 0) {
      throw new ErroApp(409, `Há ${semCorrecao} prova(s) sem correção concluída. Corrija-as antes de liberar.`);
    }

    await client.query('UPDATE avaliacao SET resultados_liberados = TRUE, atualizado_em = now() WHERE id = $1', [avaliacaoId]);
  });
  return listarTentativas(avaliacaoId, professorId);
}
