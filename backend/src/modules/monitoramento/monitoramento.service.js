// RF10 / UC10 — monitoramento da integridade da avaliação.
//
// O navegador avisa o servidor quando a janela perde o foco, quando a aba muda e quando
// o estudante usa um atalho monitorado. Aqui esses avisos viram registro, e — se a
// avaliação tiver limite de ocorrências — podem encerrar a tentativa.
//
// Três princípios atravessam este módulo, e todos vêm do DERS e da P-06:
//
//   1. **Quem decide é o servidor.** O navegador apenas relata o que aconteceu; a hora do
//      evento, a contagem e o bloqueio são do servidor. Um estudante que altere o código
//      da página pode deixar de relatar, mas não pode forjar um estado "liberado".
//   2. **Registrar não é acusar.** O sistema anota "a janela perdeu o foco", não "o
//      estudante colou". A linguagem é neutra em todo o módulo, inclusive nas mensagens,
//      porque o evento tem explicações inocentes — uma notificação, um toque acidental.
//   3. **O monitoramento não inventa o que não pode ver** (RNF12). Só existem os eventos
//      que o navegador expõe. Quando um recurso não está disponível, isso também é
//      registrado, em vez de fingir cobertura.
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { corrigirObjetivas, recalcularTentativa } from '../correcao/correcao.service.js';
import { CONTAM_PARA_O_LIMITE } from '../../dominio/monitoramento.js';
import { DESDE_A_REABERTURA, reaberturasDaTentativa } from '../correcao/correcao.service.js';

// Os tipos que o banco aceita (001_schema_inicial.sql).
export const TIPOS = ['PERDA_FOCO', 'TROCA_ABA', 'ATALHO', 'RECURSO_INDISPONIVEL', 'SAIU_TELA_CHEIA'];

// A regra de o que conta como ocorrência mora no domínio: a correção também precisa dela
// desde que as duas telas viraram uma, e um módulo importar o outro criaria ciclo.
// Reexportada daqui para não quebrar quem já a importava deste módulo.
export { CONTAM_PARA_O_LIMITE, contaParaOLimite } from '../../dominio/monitoramento.js';

const MOTIVO_BLOQUEIO =
  'A avaliação foi encerrada automaticamente: o limite de ocorrências de monitoramento definido pelo professor foi atingido.';

// Registra um lote de eventos da tentativa em andamento.
//
// Vem em lote porque a janela pode perder o foco várias vezes em poucos segundos; mandar
// um pedido por evento transformaria o monitoramento no maior gerador de tráfego da prova.
//
// Devolve o estado do monitoramento para a tela: quantas ocorrências já existem, qual é o
// limite e se a tentativa foi encerrada agora.
export async function registrarEventos(avaliacaoId, estudanteId, eventos) {
  return transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.status, a.monitoramento_ativo, a.limite_ocorrencias
         FROM tentativa t
         JOIN avaliacao a ON a.id = t.avaliacao_id
        WHERE t.avaliacao_id = $1 AND t.estudante_id = $2
        FOR UPDATE OF t`,
      [avaliacaoId, estudanteId],
    );
    const tentativa = rows[0];
    if (!tentativa) throw new ErroApp(404, 'Você ainda não iniciou esta avaliação.');

    // Prova encerrada não recebe evento novo: o que chegar depois é ruído de uma aba que
    // ficou aberta. Responder 200 com o estado evita que a tela entre em ciclo de erro.
    if (tentativa.status !== 'EM_ANDAMENTO') {
      return estadoAtual(client, tentativa, { encerradaAgora: false });
    }

    // Monitoramento desligado pelo professor (P-06): nada é gravado. A tela nem deveria
    // enviar, mas o servidor não depende disso.
    if (!tentativa.monitoramento_ativo) {
      return { monitorada: false, ocorrencias: 0, limite: null, bloqueada: false, encerradaAgora: false };
    }

    for (const evento of eventos) {
      await client.query(
        `INSERT INTO evento_monitoramento (tentativa_id, tipo, detalhe, data_hora)
         VALUES ($1, $2, $3, now())`,
        [tentativa.id, evento.tipo, evento.detalhe ?? null],
      );
    }

    const ocorrencias = await contarOcorrencias(client, tentativa.id);
    const limite = tentativa.limite_ocorrencias;

    // Sem limite definido, o monitoramento apenas registra (P-06): o professor lê os
    // eventos na correção e decide o que fazer, que é o oposto de uma acusação automática.
    if (limite === null || ocorrencias < limite) {
      return { monitorada: true, ocorrencias, limite, bloqueada: false, encerradaAgora: false };
    }

    // Limite atingido: a tentativa é encerrada com as respostas que já foram salvas —
    // nada do que o estudante escreveu se perde (P-06).
    await client.query(
      `UPDATE tentativa SET status = 'BLOQUEADA', motivo_bloqueio = $2, finalizada_em = now()
        WHERE id = $1`,
      [tentativa.id, MOTIVO_BLOQUEIO],
    );
    // O último evento registrado é o que levou ao bloqueio: fica marcado para o professor
    // saber qual foi, sem precisar contar as linhas.
    await client.query(
      `UPDATE evento_monitoramento SET bloqueou_tentativa = TRUE
        WHERE id = (SELECT id FROM evento_monitoramento
                     WHERE tentativa_id = $1 AND tipo = ANY($2)
                     ORDER BY data_hora DESC, id DESC LIMIT 1)`,
      [tentativa.id, CONTAM_PARA_O_LIMITE],
    );
    // A prova acabou: as objetivas são corrigidas agora, como no encerramento por tempo
    // (DT61), para a tentativa não ficar pendente de correção para sempre.
    await corrigirObjetivas(client, tentativa.id);
    await recalcularTentativa(client, tentativa.id);

    return { monitorada: true, ocorrencias, limite, bloqueada: true, encerradaAgora: true, motivo: MOTIVO_BLOQUEIO };
  });
}

// Conta a partir da última reabertura (migração 016). Quem foi bloqueado em 3 de 3 e
// teve a prova devolvida seria bloqueado de novo no primeiro evento se os antigos
// continuassem somando — e o perdão do professor duraria um clique. Os eventos velhos
// seguem gravados e visíveis na linha do tempo: deixam de contar, não de existir.
async function contarOcorrencias(client, tentativaId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS total FROM evento_monitoramento e
       JOIN tentativa t ON t.id = e.tentativa_id
      WHERE e.tentativa_id = $1 AND e.tipo = ANY($2)
        AND e.data_hora > ${DESDE_A_REABERTURA}`,
    [tentativaId, CONTAM_PARA_O_LIMITE],
  );
  return rows[0].total;
}

async function estadoAtual(client, tentativa, { encerradaAgora }) {
  const ocorrencias = tentativa.monitoramento_ativo ? await contarOcorrencias(client, tentativa.id) : 0;
  return {
    monitorada: tentativa.monitoramento_ativo,
    ocorrencias,
    limite: tentativa.limite_ocorrencias,
    bloqueada: tentativa.status === 'BLOQUEADA',
    encerradaAgora,
  };
}

// ------------------------------------------------------- o professor consulta (UC10)

// Resumo por estudante de uma avaliação: quantas ocorrências cada um teve, de que tipo, e
// se a prova foi encerrada pelo limite.
export async function resumoDaAvaliacao(avaliacaoId, professorId) {
  const { rows: avaliacoes } = await query(
    `SELECT id, titulo, monitoramento_ativo, limite_ocorrencias
       FROM avaliacao WHERE id = $1 AND professor_id = $2 AND status <> 'EXCLUIDA'`,
    [avaliacaoId, professorId],
  );
  if (!avaliacoes[0]) throw new ErroApp(404, 'Avaliação não encontrada.');
  const avaliacao = avaliacoes[0];

  const { rows } = await query(
    `SELECT t.id AS tentativa_id, t.status, t.motivo_bloqueio, u.id AS estudante_id, u.nome,
            count(e.id) FILTER (WHERE e.tipo = ANY($2) AND e.data_hora > ${DESDE_A_REABERTURA})::int AS ocorrencias,
            count(e.id) FILTER (WHERE e.tipo = 'PERDA_FOCO')::int AS perda_foco,
            count(e.id) FILTER (WHERE e.tipo = 'TROCA_ABA')::int AS troca_aba,
            count(e.id) FILTER (WHERE e.tipo = 'ATALHO')::int AS atalho,
            count(e.id) FILTER (WHERE e.tipo = 'RECURSO_INDISPONIVEL')::int AS recurso_indisponivel,
            count(e.id) FILTER (WHERE e.tipo = 'SAIU_TELA_CHEIA')::int AS saiu_tela_cheia,
            max(e.data_hora) AS ultimo_evento
       FROM tentativa t
       JOIN usuario u ON u.id = t.estudante_id
       LEFT JOIN evento_monitoramento e ON e.tentativa_id = t.id
      WHERE t.avaliacao_id = $1
      GROUP BY t.id, t.status, t.motivo_bloqueio, u.id, u.nome
      ORDER BY count(e.id) FILTER (WHERE e.tipo = ANY($2)) DESC, lower(u.nome)`,
    [avaliacaoId, CONTAM_PARA_O_LIMITE],
  );

  return {
    avaliacao: {
      id: avaliacao.id,
      titulo: avaliacao.titulo,
      monitoramentoAtivo: avaliacao.monitoramento_ativo,
      limiteOcorrencias: avaliacao.limite_ocorrencias,
    },
    // Sem provas feitas não há o que mostrar, e a tela diz isso em vez de uma tabela vazia.
    temDados: rows.length > 0,
    estudantes: rows.map((r) => ({
      tentativaId: r.tentativa_id,
      estudanteId: r.estudante_id,
      nome: r.nome,
      situacao: r.status,
      bloqueada: r.status === 'BLOQUEADA',
      motivoBloqueio: r.motivo_bloqueio,
      ocorrencias: r.ocorrencias,
      porTipo: {
        perdaFoco: r.perda_foco,
        trocaAba: r.troca_aba,
        atalho: r.atalho,
        recursoIndisponivel: r.recurso_indisponivel,
        saiuTelaCheia: r.saiu_tela_cheia,
      },
      ultimoEvento: r.ultimo_evento,
    })),
  };
}

// A linha do tempo de uma prova: cada evento, na ordem em que aconteceu.
//
// É o que permite ao professor julgar com contexto — cinco trocas de aba em dez minutos
// contam uma história diferente de cinco espalhadas por duas horas.
export async function eventosDaTentativa(avaliacaoId, tentativaId, professorId) {
  const { rows: tentativas } = await query(
    `SELECT t.id, t.status, t.motivo_bloqueio, t.iniciada_em, t.finalizada_em, u.nome
       FROM tentativa t
       JOIN avaliacao a ON a.id = t.avaliacao_id
       JOIN usuario u ON u.id = t.estudante_id
      WHERE t.id = $1 AND t.avaliacao_id = $2 AND a.professor_id = $3 AND a.status <> 'EXCLUIDA'`,
    [tentativaId, avaliacaoId, professorId],
  );
  if (!tentativas[0]) throw new ErroApp(404, 'Prova não encontrada.');
  const tentativa = tentativas[0];

  const { rows: eventos } = await query(
    `SELECT id, tipo, detalhe, data_hora, bloqueou_tentativa
       FROM evento_monitoramento WHERE tentativa_id = $1
      ORDER BY data_hora, id`,
    [tentativaId],
  );

  return {
    estudante: tentativa.nome,
    situacao: tentativa.status,
    // A linha do tempo precisa das devoluções para fazer sentido: cinco ocorrências
    // antes de uma reabertura e cinco depois contam histórias diferentes.
    reaberturas: await reaberturasDaTentativa({ query }, tentativaId),
    motivoBloqueio: tentativa.motivo_bloqueio,
    iniciadaEm: tentativa.iniciada_em,
    finalizadaEm: tentativa.finalizada_em,
    eventos: eventos.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      detalhe: e.detalhe,
      dataHora: e.data_hora,
      bloqueou: e.bloqueou_tentativa,
    })),
  };
}
