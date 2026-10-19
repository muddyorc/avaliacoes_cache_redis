// RF08 — Realizar Avaliações (UC08) e RF09 — Salvar Respostas Automaticamente (UC09).
//
// Regras que atravessam o módulo:
//   - Quem pode fazer (RN05): avaliação PUBLICADA, dentro do período, e vinculada a uma
//     turma em que o estudante está APROVADO. Validado aqui, no servidor, a cada
//     operação — nunca só na tela.
//   - P-04: uma tentativa por estudante por avaliação, garantida por UNIQUE no banco.
//   - DT06: o prazo é do SERVIDOR: prazo_final = min(início da tentativa + duração, fim do
//     período). O relógio do navegador não decide nada.
//   - A4 (tempo esgotado): encerramento "preguiçoso" — ao tocar na tentativa depois do
//     prazo, ela é fechada como TEMPO_ESGOTADO com as respostas que já estavam salvas.
//   - DT13: nada de gabarito, resposta esperada ou critérios chega ao estudante.
//   - RN06: respostas são preservadas; nunca apagadas.
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { prazoFinalDaProva } from '../../dominio/prazo.js';
import { corrigirObjetivas, materializarAusentesDaAvaliacao, recalcularTentativa } from '../correcao/correcao.service.js';

const NAO_DISPONIVEL = 'Avaliação não encontrada ou não disponível para você.';

// Uma avaliação só aparece para o estudante se for de uma turma dele.
// Turma inativada não retira o acesso ao que já estava vinculado (DT46).
//
// Havia aqui um segundo caminho, `a.visibilidade = 'PUBLICA' OR ...`, que abria a prova a
// qualquer estudante cadastrado. Saiu com a reversão do P-19 (13/10/2026): toda avaliação
// pertence a turmas, e esta regra ficou com um caminho só.
const ACESSO = `(
  EXISTS (
    SELECT 1 FROM avaliacao_turma at
      JOIN turma_estudante te ON te.turma_id = at.turma_id
     WHERE at.avaliacao_id = a.id AND te.estudante_id = $1 AND te.situacao = 'APROVADA'
  )
)`;

// Avaliação publicada, ou qualquer uma que o estudante já tenha começado — se o professor
// arquivar a avaliação durante a prova, quem está fazendo precisa conseguir terminar.
const VISIVEL = `(a.status = 'PUBLICADA' OR (t.id IS NOT NULL AND a.status <> 'EXCLUIDA'))`;

const CAMPOS = `
  a.id, a.titulo, a.descricao, a.duracao_minutos, a.data_inicio, a.data_fim, a.status,
  a.resultados_liberados, a.monitoramento_ativo, a.limite_ocorrencias,
  u.nome AS professor,
  (SELECT count(*)::int FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id) AS total_questoes,
  (SELECT coalesce(sum(aq.pontuacao), 0) FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id) AS pontuacao_total,
  t.id AS tentativa_id, t.status AS tentativa_status, t.iniciada_em, t.prazo_final, t.finalizada_em,
  t.motivo_bloqueio,
  t.pontuacao_total AS nota_total, t.pontuacao_objetiva AS nota_objetiva, t.correcao_concluida,
  t.visualizado_em,
  -- A turma da prova. Uma por avaliação desde a migração 012, então o LIMIT é formalidade.
  -- A lista do estudante usa para filtrar por turma: com provas de várias turmas juntas,
  -- saber de qual é cada uma é o que torna a lista legível.
  (SELECT at.turma_id FROM avaliacao_turma at WHERE at.avaliacao_id = a.id LIMIT 1) AS turma_id,
  (SELECT tu.nome FROM avaliacao_turma at JOIN turma tu ON tu.id = at.turma_id
    WHERE at.avaliacao_id = a.id LIMIT 1) AS turma_nome`;

const DE = `
  FROM avaliacao a
  JOIN usuario u ON u.id = a.professor_id
  LEFT JOIN tentativa t ON t.avaliacao_id = a.id AND t.estudante_id = $1`;

// Situação do ponto de vista do estudante. Cobre A1 (ainda não disponível) e A2 (período
// encerrado) do UC08.
function situacaoPara(linha, agora) {
  if (linha.tentativa_id) {
    if (linha.tentativa_status !== 'EM_ANDAMENTO') return linha.tentativa_status;
    // Ainda marcada como em andamento, mas o prazo passou: será fechada no próximo acesso.
    return new Date(linha.prazo_final) <= agora ? 'TEMPO_ESGOTADO' : 'EM_ANDAMENTO';
  }
  if (agora < new Date(linha.data_inicio)) return 'AGENDADA';
  if (agora > new Date(linha.data_fim)) return 'ENCERRADA';
  return 'DISPONIVEL';
}

function formatar(linha, agora = new Date()) {
  const situacao = situacaoPara(linha, agora);
  return {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    professor: linha.professor,
    duracaoMinutos: linha.duracao_minutos,
    dataInicio: linha.data_inicio,
    dataFim: linha.data_fim,
    turma: linha.turma_id ? { id: linha.turma_id, nome: linha.turma_nome } : null,
    totalQuestoes: linha.total_questoes,
    pontuacaoTotal: linha.pontuacao_total,
    // RF10: o estudante precisa saber, antes de começar, que a prova registra eventos do
    // navegador e o que acontece ao atingir o limite. Monitorar sem avisar seria
    // vigilância; avisar é o que torna a regra legítima.
    monitoramentoAtivo: linha.monitoramento_ativo,
    limiteOcorrencias: linha.limite_ocorrencias,
    situacao,
    podeIniciar: situacao === 'DISPONIVEL' && linha.total_questoes > 0,
    podeContinuar: situacao === 'EM_ANDAMENTO',
    tentativa: linha.tentativa_id
      ? {
          iniciadaEm: linha.iniciada_em,
          prazoFinal: linha.prazo_final,
          finalizadaEm: linha.finalizada_em,
          // Quando a prova foi encerrada pelo monitoramento, o estudante lê o motivo —
          // em vez de descobrir sozinho que não consegue mais responder (P-06).
          motivoBloqueio: linha.motivo_bloqueio,
        }
      : null,
    // P-07: a nota só chega ao estudante quando o professor libera os resultados E a
    // correção daquela prova está concluída. Antes disso o campo nem é enviado — não
    // adianta esconder na tela se a API entrega o número.
    resultadosLiberados: linha.resultados_liberados,
    resultado:
      linha.resultados_liberados && linha.tentativa_id && linha.correcao_concluida
        ? {
            nota: linha.nota_total,
            notaObjetivas: linha.nota_objetiva,
            pontuacaoMaxima: linha.pontuacao_total,
            // Quando o estudante abriu este resultado (migração 015). Nulo = ele ainda
            // não viu, e é disso que o sino de avisos precisa saber.
            visualizadoEm: linha.visualizado_em,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------- consulta

export async function listar(estudanteId) {
  const { rows } = await query(
    `SELECT ${CAMPOS} ${DE} WHERE ${VISIVEL} AND ${ACESSO} ORDER BY a.data_fim, a.id`,
    [estudanteId],
  );
  const agora = new Date();
  return { avaliacoes: rows.map((linha) => formatar(linha, agora)), horaServidor: agora.toISOString() };
}

// As avaliações de UMA turma, do ponto de vista do estudante. Mesmas regras da listagem
// geral (`VISIVEL` e `ACESSO`), mais o vínculo com a turma pedida: o filtro é por
// `avaliacao_turma`, então prova pública sem vínculo não entra na turma de ninguém.
export async function listarDaTurma(estudanteId, turmaId) {
  const { rows } = await query(
    `SELECT ${CAMPOS} ${DE}
      WHERE ${VISIVEL} AND ${ACESSO}
        AND EXISTS (SELECT 1 FROM avaliacao_turma at WHERE at.avaliacao_id = a.id AND at.turma_id = $2)
      ORDER BY a.data_fim, a.id`,
    [estudanteId, turmaId],
  );
  const agora = new Date();
  return { avaliacoes: rows.map((linha) => formatar(linha, agora)), horaServidor: agora.toISOString() };
}

async function carregar(executor, avaliacaoId, estudanteId, { travar = false } = {}) {
  const { rows } = await executor.query(
    // FOR SHARE em `a`: segura a avaliação enquanto a tentativa é criada ou alterada,
    // para não cruzar com uma edição do professor (que usa FOR UPDATE). A tentativa é
    // travada logo abaixo, e não aqui: o PostgreSQL recusa FOR UPDATE no lado opcional
    // de um LEFT JOIN, e a tentativa pode ainda não existir.
    `SELECT ${CAMPOS} ${DE} WHERE a.id = $2 AND ${VISIVEL} AND ${ACESSO} ${travar ? 'FOR SHARE OF a' : ''}`,
    [estudanteId, avaliacaoId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_DISPONIVEL);

  // Serializa dois salvamentos simultâneos da mesma tentativa (duas abas, por exemplo).
  if (travar && rows[0].tentativa_id) {
    await executor.query('SELECT 1 FROM tentativa WHERE id = $1 FOR UPDATE', [rows[0].tentativa_id]);
  }
  return rows[0];
}

export async function detalhar(avaliacaoId, estudanteId) {
  // Abrir a prova depois do prazo é um dos momentos que registram a ausência em branco
  // (migração 014) — os outros são o professor abrir a correção ou o dashboard. Sem
  // isto, o estudante que faltou via a tela de instruções com o botão Iniciar desligado
  // e nada mais: nem a própria prova registrada, nem o bloco de resultado que o resto da
  // turma vê. A função não faz nada com o período aberto, que é o caso comum aqui.
  await materializarAusentesDaAvaliacao(avaliacaoId);
  return formatar(await carregar({ query }, avaliacaoId, estudanteId));
}

// ------------------------------------------------------------------ congelamento

// Quando o PRIMEIRO estudante inicia a prova, ela guarda a sua própria cópia de cada
// questão: enunciado, tipo, referência da discursiva e alternativas com o gabarito
// daquele momento (migração 004).
//
// A partir daí a prova não depende mais do banco de questões: o professor pode corrigir,
// reescrever ou inativar a questão no banco sem mexer no que já foi aplicado, e a
// correção continua comparando com o gabarito que o estudante viu.
//
// Roda dentro da transação que cria a tentativa, com a avaliação já travada, então duas
// entradas simultâneas não congelam duas vezes.
export async function congelarQuestoes(client, avaliacaoId) {
  const { rowCount } = await client.query(
    `UPDATE avaliacao_questao aq
        SET enunciado = q.enunciado, tipo = q.tipo, tema = q.tema,
            resposta_esperada = q.resposta_esperada, criterios_correcao = q.criterios_correcao,
            -- O tipo de resposta também congela: se a questão do banco virar de múltipla
            -- escolha depois, a prova já aplicada continua sendo o que o estudante viu.
            multiplas_corretas = q.multiplas_corretas,
            congelada_em = now()
       FROM questao q
      WHERE q.id = aq.questao_id AND aq.avaliacao_id = $1 AND aq.congelada_em IS NULL`,
    [avaliacaoId],
  );
  if (rowCount === 0) return false; // já estava congelada

  await client.query(
    `INSERT INTO avaliacao_alternativa (avaliacao_id, questao_id, origem_id, ordem, texto, correta)
     SELECT aq.avaliacao_id, aq.questao_id, al.id, al.ordem, al.texto, al.correta
       FROM avaliacao_questao aq
       JOIN alternativa al ON al.questao_id = aq.questao_id
      WHERE aq.avaliacao_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM avaliacao_alternativa ea
           WHERE ea.avaliacao_id = aq.avaliacao_id AND ea.questao_id = aq.questao_id
        )`,
    [avaliacaoId],
  );
  return true;
}

// ------------------------------------------------------------- questões e respostas

// As questões como o estudante as vê: sem `correta`, sem resposta esperada, sem critérios.
async function questoesDaProva(executor, avaliacaoId) {
  // Depois do congelamento vale a cópia da prova; antes, o banco de questões — é o caso
  // do modo teste do professor (P-20), que roda em avaliação que ninguém iniciou.
  const { rows: questoes } = await executor.query(
    `SELECT aq.questao_id, aq.ordem, aq.pontuacao, aq.congelada_em,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            COALESCE(aq.multiplas_corretas, q.multiplas_corretas) AS multiplas_corretas
       FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
      WHERE aq.avaliacao_id = $1 ORDER BY aq.ordem`,
    [avaliacaoId],
  );
  // O id da alternativa muda de origem conforme o congelamento; é esse id que o
  // estudante devolve ao responder, e é por ele que a resposta é gravada.
  const { rows: congeladas } = await executor.query(
    `SELECT ea.id, ea.questao_id, ea.ordem, ea.texto, ea.origem_id
       FROM avaliacao_alternativa ea
      WHERE ea.avaliacao_id = $1 ORDER BY ea.questao_id, ea.ordem`,
    [avaliacaoId],
  );
  const { rows: doBanco } = await executor.query(
    `SELECT al.id, al.questao_id, al.ordem, al.texto, NULL::int AS origem_id
       FROM alternativa al JOIN avaliacao_questao aq ON aq.questao_id = al.questao_id
      WHERE aq.avaliacao_id = $1 AND aq.congelada_em IS NULL ORDER BY al.questao_id, al.ordem`,
    [avaliacaoId],
  );
  const alternativas = [...congeladas, ...doBanco];

  return questoes.map((q) => ({
    questaoId: q.questao_id,
    ordem: q.ordem,
    tipo: q.tipo,
    enunciado: q.enunciado,
    pontuacao: q.pontuacao,
    congelada: q.congelada_em !== null,
    // P-26: a tela usa isso para decidir entre escolher uma e marcar várias.
    //
    // O nome é o do ponto de vista de quem responde — "você pode marcar várias" —, e não
    // "existem várias corretas". Os dois lados perguntam coisas diferentes, e o estudante
    // não fica sabendo quantas são certas. De quebra, mantém o teste de vazamento do
    // gabarito (DT13) podendo procurar a palavra "correta" no corpo inteiro da prova.
    marcarVarias: Boolean(q.multiplas_corretas),
    alternativas: alternativas
      .filter((a) => a.questao_id === q.questao_id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto, origemId: a.origem_id })),
  }));
}

// A fronteira da trava: o instante a partir do qual as respostas ainda podem mudar.
//
// É o mais recente entre a última devolução pelo professor (migração 016) e a última vez
// que o estudante reabriu a prova (migração 017). Resposta anterior a isso está fechada.
//
// Vive numa constante porque três consultas precisam da mesma definição, e duas noções
// de "o que está travado" divergiriam no primeiro ajuste.
const FRONTEIRA_DA_TRAVA = `GREATEST(
  COALESCE(t.retomada_em, '-infinity'::timestamptz),
  COALESCE((SELECT max(rb.reaberta_em) FROM reabertura_tentativa rb WHERE rb.tentativa_id = t.id),
           '-infinity'::timestamptz))`;

// Uma resposta dada ANTES de o estudante sair da prova não pode mais ser alterada
// (migrações 016 e 017, decisões do autor em 18/10/2026).
//
// Duas razões, uma para cada caso. Na devolução: ela existe para o estudante TERMINAR
// a prova, não para revisá-la — quem a recebe ganha tempo que os colegas não tiveram, e
// deixar o já respondido editável transformaria o perdão em vantagem. Na retomada: o que
// foi respondido antes de sair fica como está, e a prova deixa de ser um formulário
// editável até o fim para ser uma sequência de respostas confirmadas.
//
// Nos dois casos, o que for marcado DEPOIS continua editável até a entrega — senão um
// clique errado logo após voltar seria irreversível.
async function respostasSalvas(executor, tentativaId) {
  const { rows } = await executor.query(
    `SELECT r.id, r.questao_id, r.alternativa_id, r.avaliacao_alternativa_id, r.texto, r.atualizada_em,
            (r.atualizada_em <= ${FRONTEIRA_DA_TRAVA}) AS travada,
            -- P-26: as marcações da questão de múltipla escolha, pelo id que a tela conhece.
            (SELECT coalesce(array_agg(coalesce(ra.avaliacao_alternativa_id, ra.alternativa_id)), ARRAY[]::int[])
               FROM resposta_alternativa ra WHERE ra.resposta_id = r.id) AS marcadas
       FROM resposta r JOIN tentativa t ON t.id = r.tentativa_id
      WHERE r.tentativa_id = $1`,
    [tentativaId],
  );
  return rows.map((r) => ({
    questaoId: r.questao_id,
    // A tela marcou a alternativa pelo id que recebeu — o da cópia, se a prova congelou.
    alternativaId: r.avaliacao_alternativa_id ?? r.alternativa_id,
    alternativaIds: r.marcadas,
    texto: r.texto,
    atualizadaEm: r.atualizada_em,
    travada: r.travada,
  }));
}

// Estado completo da prova em andamento (ou encerrada), incluindo a hora do servidor
// para o cronômetro da tela se orientar sem depender do relógio do computador.
async function estadoDaTentativa(executor, linha, avaliacaoId) {
  const agora = new Date();
  return {
    avaliacao: formatar(linha, agora),
    questoes: await questoesDaProva(executor, avaliacaoId),
    respostas: linha.tentativa_id ? await respostasSalvas(executor, linha.tentativa_id) : [],
    horaServidor: agora.toISOString(),
  };
}

// A4 — encerramento "preguiçoso": não há processo em segundo plano fechando tentativas.
// Quem toca na tentativa depois do prazo a encerra, com as respostas já salvas (RN06).
// `finalizada_em` recebe o PRAZO, e não "agora": a prova acabou na hora do prazo.
//
// Roda em TRANSAÇÃO PRÓPRIA, antes da operação pedida. Se ficasse dentro da transação
// da operação, o `throw` que informa "o tempo terminou" desfaria o encerramento no
// ROLLBACK, e a tentativa continuaria aberta para sempre.
async function encerrarSePrazoVencido(avaliacaoId, estudanteId) {
  await transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM tentativa
        WHERE avaliacao_id = $1 AND estudante_id = $2 AND status = 'EM_ANDAMENTO' AND prazo_final <= now()
        FOR UPDATE`,
      [avaliacaoId, estudanteId],
    );
    if (!rows[0]) return;
    await client.query(
      "UPDATE tentativa SET status = 'TEMPO_ESGOTADO', finalizada_em = prazo_final WHERE id = $1",
      [rows[0].id],
    );
    // A prova acabou: as objetivas já ficam corrigidas (RF11, P-12). Se a avaliação não
    // tem discursivas, a correção termina aqui mesmo.
    await corrigirObjetivas(client, rows[0].id);
    await recalcularTentativa(client, rows[0].id);
  });
}

// ------------------------------------------------------------------ iniciar (UC08)

export async function iniciar(avaliacaoId, estudanteId) {
  await encerrarSePrazoVencido(avaliacaoId, estudanteId);
  return transacao(async (client) => {
    const linha = await carregar(client, avaliacaoId, estudanteId, { travar: true });

    if (linha.tentativa_id) {
      // Recomeçar não é permitido (P-04); continuar, sim.
      if (linha.tentativa_status === 'EM_ANDAMENTO') return estadoDaTentativa(client, linha, avaliacaoId);
      throw new ErroApp(409, 'Você já realizou esta avaliação. Só é permitida uma tentativa.');
    }

    const agora = new Date();
    if (linha.status !== 'PUBLICADA') throw new ErroApp(409, NAO_DISPONIVEL);
    // A1 e A2 do UC08, agora como recusa: a tela já mostra a situação antes de chegar aqui.
    if (agora < new Date(linha.data_inicio)) {
      throw new ErroApp(409, 'Esta avaliação ainda não está disponível.');
    }
    if (agora > new Date(linha.data_fim)) {
      throw new ErroApp(409, 'O período de realização desta avaliação foi encerrado.');
    }
    if (linha.total_questoes === 0) throw new ErroApp(409, 'Esta avaliação não tem questões.');

    // A prova guarda a sua cópia das questões antes de a primeira tentativa existir: daí
    // em diante o banco de questões pode mudar sem alterar o que já foi aplicado.
    await congelarQuestoes(client, avaliacaoId);

    // DT06: o prazo é o menor entre o tempo da prova e o fim do período.
    const prazoFinal = prazoFinalDaProva(agora, linha.duracao_minutos, linha.data_fim);

    // Em qual turma esta prova está sendo feita. Fica gravado junto da tentativa porque
    // é isso que define com quem o estudante vai se comparar depois — e o vínculo com a
    // turma pode mudar (ele sai, entra em outra) sem que o histórico deva mudar junto.
    const turmaId = await turmaDaProva(client, avaliacaoId, estudanteId);

    let tentativa;
    try {
      const { rows } = await client.query(
        `INSERT INTO tentativa (avaliacao_id, estudante_id, iniciada_em, prazo_final, turma_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [avaliacaoId, estudanteId, agora, prazoFinal, turmaId],
      );
      tentativa = rows[0].id;
    } catch (erro) {
      // Dois cliques simultâneos em "Iniciar": o UNIQUE do banco decide (P-04).
      if (erro.code === '23505') throw new ErroApp(409, 'Esta avaliação já foi iniciada por você.');
      throw erro;
    }

    return estadoDaTentativa(client, { ...linha, tentativa_id: tentativa, tentativa_status: 'EM_ANDAMENTO', iniciada_em: agora, prazo_final: prazoFinal }, avaliacaoId);
  });
}

// A turma pela qual o estudante chegou a esta avaliação: a interseção entre as turmas
// da avaliação e as turmas aprovadas dele. Com duas ou mais, não há como saber por qual
// delas a prova foi feita — e uma avaliação pública pode ser feita sem turma nenhuma —,
// então nesses casos fica nulo e a comparação volta a ser com todas as provas.
async function turmaDaProva(client, avaliacaoId, estudanteId) {
  const { rows } = await client.query(
    `SELECT at.turma_id
       FROM avaliacao_turma at
       JOIN turma_estudante te ON te.turma_id = at.turma_id
      WHERE at.avaliacao_id = $1 AND te.estudante_id = $2 AND te.situacao = 'APROVADA'`,
    [avaliacaoId, estudanteId],
  );
  return rows.length === 1 ? rows[0].turma_id : null;
}

// Retomar a prova (recarregar a página, trocar de dispositivo, voltar de uma queda).
export async function retomar(avaliacaoId, estudanteId) {
  await encerrarSePrazoVencido(avaliacaoId, estudanteId);
  return transacao(async (client) => {
    const linha = await carregar(client, avaliacaoId, estudanteId, { travar: true });
    if (!linha.tentativa_id) throw new ErroApp(409, 'Você ainda não iniciou esta avaliação.');

    // Voltar à prova fecha o que já estava respondido (migração 017). A marca é gravada
    // ANTES de montar a resposta, para a tela já receber as questões na situação certa
    // — e não com um estado que mudaria no próximo carregamento.
    //
    // Recarregar a página conta como voltar. É consequência assumida da regra: a prova
    // é uma sequência de respostas confirmadas, não um formulário aberto até o fim.
    if (linha.tentativa_status === 'EM_ANDAMENTO') {
      await client.query('UPDATE tentativa SET retomada_em = now() WHERE id = $1', [linha.tentativa_id]);
    }
    return estadoDaTentativa(client, linha, avaliacaoId);
  });
}

// ------------------------------------------------------- salvar respostas (UC09)

// Grava o lote de respostas. UPSERT por (tentativa, questão): salvar de novo a mesma
// questão atualiza a linha, nunca cria outra nem apaga o que já existe.
// As questões que já não aceitam mudança nesta tentativa.
async function questoesFechadas(executor, tentativaId) {
  const { rows } = await executor.query(
    `SELECT r.questao_id FROM resposta r JOIN tentativa t ON t.id = r.tentativa_id
      WHERE r.tentativa_id = $1 AND r.atualizada_em <= ${FRONTEIRA_DA_TRAVA}`,
    [tentativaId],
  );
  return new Set(rows.map((r) => r.questao_id));
}

export async function salvarRespostas(avaliacaoId, estudanteId, respostas) {
  await encerrarSePrazoVencido(avaliacaoId, estudanteId);
  return transacao(async (client) => {
    const linha = await carregar(client, avaliacaoId, estudanteId, { travar: true });
    if (!linha.tentativa_id) throw new ErroApp(409, 'Você ainda não iniciou esta avaliação.');

    if (linha.tentativa_status !== 'EM_ANDAMENTO') {
      // A4: depois do prazo o sistema "encerra a possibilidade de alteração".
      throw new ErroApp(409, 'O tempo desta avaliação terminou. As respostas salvas foram mantidas.', {
        situacao: linha.tentativa_status,
      });
    }

    const questoes = await questoesDaProva(client, avaliacaoId);
    const porQuestao = new Map(questoes.map((q) => [q.questaoId, q]));

    // A tela já desabilita as travadas, mas quem decide é o servidor: desabilitar um
    // campo é sugestão ao navegador, não garantia. Uma única consulta traz as que estão
    // fechadas, e o lote inteiro é recusado se tocar numa delas — recusar só a parte
    // deixaria o estudante achando que salvou o que não salvou.
    const fechadas = await questoesFechadas(client, linha.tentativa_id);
    if (respostas.some((r) => fechadas.has(r.questaoId))) {
      throw new ErroApp(
        409,
        'As questões que você já tinha respondido não podem ser alteradas. Você pode responder as que ficaram em branco.',
      );
    }

    for (const r of respostas) {
      const questao = porQuestao.get(r.questaoId);
      if (!questao) throw new ErroApp(400, 'Há respostas para questões que não fazem parte desta avaliação.');

      let alternativaId = null;
      let congeladaId = null;
      let texto = null;
      // P-26: na questão de múltipla escolha as marcações vão para `resposta_alternativa`,
      // e as colunas de alternativa da `resposta` ficam nulas. São dois caminhos, e o tipo
      // da questão diz qual vale — em vez de um caminho só que obrigaria a reescrever toda
      // a resposta única, que funciona desde a Etapa 6.
      let marcadas = null;

      if (questao.tipo === 'OBJETIVA' && questao.marcarVarias) {
        const pedidas = Array.isArray(r.alternativaIds) ? [...new Set(r.alternativaIds)] : [];
        marcadas = pedidas.map((id) => {
          const escolhida = questao.alternativas.find((a) => a.id === id);
          if (!escolhida) throw new ErroApp(400, 'Há uma alternativa que não pertence à questão respondida.');
          return questao.congelada
            ? { alternativaId: escolhida.origemId, congeladaId: escolhida.id }
            : { alternativaId: escolhida.id, congeladaId: null };
        });
      } else if (questao.tipo === 'OBJETIVA') {
        const escolhida = r.alternativaId == null ? null : questao.alternativas.find((a) => a.id === r.alternativaId);
        if (r.alternativaId != null && !escolhida) {
          throw new ErroApp(400, 'Há uma alternativa que não pertence à questão respondida.');
        }
        if (escolhida) {
          // Prova congelada: a escolha é da cópia, e `alternativa_id` fica só como origem.
          congeladaId = questao.congelada ? escolhida.id : null;
          alternativaId = questao.congelada ? escolhida.origemId : escolhida.id;
        }
      } else {
        texto = r.texto?.trim() ? r.texto : null;
      }

      const { rows: gravada } = await client.query(
        `INSERT INTO resposta (tentativa_id, questao_id, alternativa_id, avaliacao_alternativa_id, texto, atualizada_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (tentativa_id, questao_id)
         DO UPDATE SET alternativa_id = EXCLUDED.alternativa_id,
                       avaliacao_alternativa_id = EXCLUDED.avaliacao_alternativa_id,
                       texto = EXCLUDED.texto, atualizada_em = now()
         RETURNING id`,
        [linha.tentativa_id, r.questaoId, alternativaId, congeladaId, texto],
      );

      if (marcadas !== null) {
        // Trocar o conjunto inteiro é o que o autosave precisa: desmarcar uma alternativa
        // é tão válido quanto marcar outra, e um `INSERT ... ON CONFLICT` sozinho não
        // apagaria a que saiu.
        await client.query('DELETE FROM resposta_alternativa WHERE resposta_id = $1', [gravada[0].id]);
        for (const m of marcadas) {
          await client.query(
            'INSERT INTO resposta_alternativa (resposta_id, alternativa_id, avaliacao_alternativa_id) VALUES ($1, $2, $3)',
            [gravada[0].id, m.congeladaId ? null : m.alternativaId, m.congeladaId],
          );
        }
      }
    }

    const { rows } = await client.query('SELECT max(atualizada_em) AS salvo_em FROM resposta WHERE tentativa_id = $1', [
      linha.tentativa_id,
    ]);
    return {
      salvoEm: rows[0].salvo_em,
      prazoFinal: linha.prazo_final,
      horaServidor: new Date().toISOString(),
      situacao: 'EM_ANDAMENTO',
    };
  });
}

// ------------------------------------------------------------- finalizar (UC08, A3)

// A confirmação é da tela (UC08, passos 13 e 14). Aqui a tentativa é encerrada de fato.
// `respostas` permite enviar o que estiver pendente junto com a entrega.
export async function finalizar(avaliacaoId, estudanteId, respostas = []) {
  if (respostas.length) {
    try {
      // As travadas são DESCARTADAS aqui, em vez de derrubarem o lote.
      //
      // O `catch` abaixo engole o 409 de propósito, para o caso de o prazo vencer no meio
      // da entrega. Sem este filtro, uma única resposta fechada faria o lote inteiro ser
      // recusado — e o `catch` descartaria em silêncio tudo o que o estudante acabou de
      // responder. Perder trabalho sem aviso é o pior desfecho possível para esta tela.
      const { rows } = await query('SELECT id FROM tentativa WHERE avaliacao_id = $1 AND estudante_id = $2', [
        avaliacaoId,
        estudanteId,
      ]);
      const fechadas = rows[0] ? await questoesFechadas({ query }, rows[0].id) : new Set();
      const abertas = respostas.filter((r) => !fechadas.has(r.questaoId));
      if (abertas.length) await salvarRespostas(avaliacaoId, estudanteId, abertas);
    } catch (erro) {
      // Se o prazo venceu no meio da entrega, o encerramento por tempo já aconteceu e as
      // respostas salvas até ali valem; qualquer outro erro é real.
      if (!(erro instanceof ErroApp) || erro.status !== 409) throw erro;
    }
  }

  await encerrarSePrazoVencido(avaliacaoId, estudanteId);
  return transacao(async (client) => {
    const linha = await carregar(client, avaliacaoId, estudanteId, { travar: true });
    if (!linha.tentativa_id) throw new ErroApp(409, 'Você ainda não iniciou esta avaliação.');

    if (linha.tentativa_status !== 'EM_ANDAMENTO') {
      const { rows } = await client.query('SELECT status, finalizada_em FROM tentativa WHERE id = $1', [linha.tentativa_id]);
      return {
        situacao: rows[0].status,
        finalizadaEm: rows[0].finalizada_em,
        jaEstavaEncerrada: true,
      };
    }

    const agora = new Date();
    await client.query("UPDATE tentativa SET status = 'FINALIZADA', finalizada_em = $2 WHERE id = $1", [
      linha.tentativa_id,
      agora,
    ]);
    // Correção automática das objetivas na entrega (RF11): comparar com o gabarito não
    // depende de ninguém. A nota das discursivas é do professor, e a nota só chega ao
    // estudante depois da liberação (P-07).
    await corrigirObjetivas(client, linha.tentativa_id);
    await recalcularTentativa(client, linha.tentativa_id);
    return { situacao: 'FINALIZADA', finalizadaEm: agora.toISOString(), jaEstavaEncerrada: false };
  });
}
