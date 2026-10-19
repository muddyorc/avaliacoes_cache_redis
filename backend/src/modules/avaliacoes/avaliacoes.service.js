// RF03 — Criar Avaliações (UC03) e RF04 — Gerenciar Avaliações (UC04).
//
// Regras que atravessam todo o módulo:
//   - RN02: só professor; cada professor vê e altera SOMENTE as próprias avaliações
//     (a de outro responde 404, para não revelar que existe).
//   - P-15a: enquanto nenhum estudante INICIOU a avaliação, ela é editável. Depois da
//     primeira tentativa, fica estruturalmente bloqueada: nada de título, descrição,
//     duração, período, monitoramento ou questões. Continua possível consultar,
//     arquivar e duplicar. "Iniciada" = existe linha em `tentativa`, que só nasce quando
//     o estudante começa de fato a prova (Etapa 6) — abrir a página não conta.
//   - RN01: publicar exige ao menos uma questão.
//   - Quadro 31 / DT14: "excluir" muda o status para EXCLUIDA; a linha permanece.
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { gravarQuestaoNova, regravarQuestao } from '../questoes/questoes.service.js';

const NAO_ENCONTRADA = 'Avaliação não encontrada.';
const BLOQUEADA =
  'Esta avaliação já foi iniciada por estudantes e não pode mais ser alterada. ' +
  'Você pode consultá-la, arquivá-la ou duplicá-la para criar uma nova avaliação.';

// Contadores que alimentam as regras e a interface, calculados no próprio SELECT.
const RESUMO = `
  (SELECT count(*)::int FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id) AS total_questoes,
  (SELECT coalesce(sum(aq.pontuacao), 0) FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id) AS pontuacao_total,
  (SELECT count(*)::int FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
    WHERE aq.avaliacao_id = a.id AND q.situacao = 'INATIVA'
      AND aq.congelada_em IS NULL) AS questoes_inativas,
  (SELECT count(*)::int FROM tentativa t WHERE t.avaliacao_id = a.id) AS total_tentativas,
  (SELECT count(*)::int FROM avaliacao_turma at WHERE at.avaliacao_id = a.id) AS total_turmas,
  (SELECT count(*)::int FROM tentativa t
    WHERE t.avaliacao_id = a.id AND (t.status = 'EM_ANDAMENTO' OR NOT t.correcao_concluida)) AS provas_pendentes`;

// O que impede a publicação agora. Lista vazia = pode publicar. Também é a checagem
// que uma avaliação JÁ publicada precisa continuar passando depois de uma edição.
function pendenciasDePublicacao(linha, agora = new Date()) {
  const pendencias = [];
  if (linha.total_questoes === 0) {
    pendencias.push('Adicione ao menos uma questão.');
  }
  if (linha.questoes_inativas > 0) {
    pendencias.push(
      linha.questoes_inativas === 1
        ? 'Há 1 questão inativa na avaliação. Remova-a ou reative-a no banco de questões.'
        : `Há ${linha.questoes_inativas} questões inativas na avaliação. Remova-as ou reative-as no banco de questões.`,
    );
  }
  if (new Date(linha.data_fim) <= agora) {
    pendencias.push('O período da avaliação já terminou. Ajuste a data de término.');
  }
  // Toda avaliação pertence a turmas: sem nenhuma vinculada, ninguém poderia fazê-la.
  // A regra era condicional enquanto existiu avaliação pública, que dispensava turma
  // (P-19, revertido a pedido do orientador em 13/10/2026).
  if (linha.total_turmas === 0) {
    pendencias.push('Vincule ao menos uma turma.');
  }
  return pendencias;
}

function formatar(linha, questoes) {
  const iniciada = linha.total_tentativas > 0;
  const editavel = !iniciada && ['RASCUNHO', 'PUBLICADA'].includes(linha.status);
  const pendencias = pendenciasDePublicacao(linha);

  const avaliacao = {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    duracaoMinutos: linha.duracao_minutos,
    dataInicio: linha.data_inicio,
    dataFim: linha.data_fim,
    status: linha.status,
    monitoramentoAtivo: linha.monitoramento_ativo,
    limiteOcorrencias: linha.limite_ocorrencias,
    resultadosLiberados: linha.resultados_liberados,
    // O que o estudante enxerga quando os resultados são liberados (RF13 estendido).
    // A nota individual não entra aqui: ela sai sempre que há liberação.
    divulgacao: {
      gabarito: linha.mostrar_gabarito,
      mediaTurma: linha.mostrar_media_turma,
      distribuicao: linha.mostrar_distribuicao,
      questoesDestaque: linha.mostrar_questoes_destaque,
    },
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    totalQuestoes: linha.total_questoes,
    pontuacaoTotal: linha.pontuacao_total,
    totalTentativas: linha.total_tentativas,
    totalTurmas: linha.total_turmas,
    iniciada,
    pendenciasPublicacao: pendencias,
    // Resumo pronto para a interface: o que pode ser feito agora com a avaliação.
    acoes: {
      podeEditar: editavel,
      podePublicar: linha.status === 'RASCUNHO' && pendencias.length === 0,
      podeArquivar: ['RASCUNHO', 'PUBLICADA'].includes(linha.status),
      podeExcluir: !iniciada,
      podeDuplicar: true,
      // P-07: liberar exige toda prova encerrada e corrigida. A regra vive no módulo de
      // correção; aqui ela é só antecipada para a tela poder desabilitar o botão.
      podeLiberarResultados:
        linha.total_tentativas > 0 && linha.provas_pendentes === 0 && !linha.resultados_liberados,
      // DT41: acrescentar turma é permitido mesmo depois do início; retirar, não.
      podeVincularTurmas: ['RASCUNHO', 'PUBLICADA'].includes(linha.status),
      podeDesvincularTurmas: ['RASCUNHO', 'PUBLICADA'].includes(linha.status) && !iniciada,
    },
  };
  if (questoes) avaliacao.questoes = questoes;
  return avaliacao;
}

async function carregarTurmas(executor, avaliacaoId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.nome, t.situacao, at.vinculado_em,
            (SELECT count(*)::int FROM turma_estudante te WHERE te.turma_id = t.id AND te.situacao = 'APROVADA') AS total_estudantes
       FROM avaliacao_turma at JOIN turma t ON t.id = at.turma_id
      WHERE at.avaliacao_id = $1
      ORDER BY lower(t.nome)`,
    [avaliacaoId],
  );
  return rows.map((t) => ({
    id: t.id,
    nome: t.nome,
    situacao: t.situacao,
    vinculadoEm: t.vinculado_em,
    totalEstudantes: t.total_estudantes,
  }));
}

// Carrega garantindo a PROPRIEDADE. Avaliação excluída é tratada como inexistente.
async function carregar(executor, id, professorId, { travar = false } = {}) {
  // FOR UPDATE trava só a linha da avaliação; as subconsultas de RESUMO não são travadas.
  const { rows } = await executor.query(
    `SELECT a.*, ${RESUMO}
       FROM avaliacao a
      WHERE a.id = $1 AND a.professor_id = $2 AND a.status <> 'EXCLUIDA'
      ${travar ? 'FOR UPDATE OF a' : ''}`,
    [id, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
  return rows[0];
}

async function carregarQuestoes(executor, avaliacaoId) {
  const { rows } = await executor.query(
    // Depois do congelamento (migração 004) o editor mostra o texto da PROVA, não o do
    // banco: é o que os estudantes responderam.
    `SELECT aq.questao_id, aq.ordem, aq.pontuacao, aq.congelada_em,
            COALESCE(aq.tipo, q.tipo) AS tipo,
            COALESCE(aq.enunciado, q.enunciado) AS enunciado,
            COALESCE(aq.tema, q.tema) AS tema,
            q.situacao, q.pontuacao_padrao, q.no_banco
       FROM avaliacao_questao aq
       JOIN questao q ON q.id = aq.questao_id
      WHERE aq.avaliacao_id = $1
      ORDER BY aq.ordem`,
    [avaliacaoId],
  );
  // Depois do congelamento as alternativas da prova vêm junto: são elas que o editor
  // precisa mostrar, e não as do banco, que podem já ter sido reescritas (P-22).
  const { rows: congeladas } = await executor.query(
    `SELECT questao_id, id, ordem, texto, correta
       FROM avaliacao_alternativa WHERE avaliacao_id = $1 ORDER BY questao_id, ordem`,
    [avaliacaoId],
  );

  return rows.map((r) => {
    const questao = {
      questaoId: r.questao_id,
      ordem: r.ordem,
      pontuacao: r.pontuacao,
      tipo: r.tipo,
      enunciado: r.enunciado,
      tema: r.tema,
      situacao: r.situacao,
      pontuacaoPadrao: r.pontuacao_padrao,
      congelada: r.congelada_em !== null,
      // A tela oferece "Adicionar ao banco" para quem ainda não está lá — questão escrita
      // para esta prova e que o professor pode decidir reaproveitar depois.
      noBanco: r.no_banco !== false,
    };
    // Prova ainda não aplicada continua sem gabarito aqui: para montá-la basta o
    // enunciado, e as alternativas estão no banco de questões (DT64). Depois de
    // congelada, a cópia vem junto — é a única fonte do que a prova realmente aplicou,
    // e quem lê esta rota é o professor dono.
    if (questao.congelada) {
      questao.alternativas = congeladas
        .filter((a) => a.questao_id === r.questao_id)
        .map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto, correta: a.correta }));
    }
    return questao;
  });
}

function exigirEditavel(linha) {
  if (linha.total_tentativas > 0) throw new ErroApp(409, BLOQUEADA);
  if (linha.status === 'ARQUIVADA') {
    throw new ErroApp(409, 'Avaliação arquivada não pode ser alterada. Duplique-a para reutilizar.');
  }
}

// Uma avaliação publicada precisa continuar publicável depois de qualquer edição: sem
// isso, dava para publicar e em seguida tirar todas as questões, burlando RN01.
async function exigirPublicadaValida(client, id, professorId) {
  const linha = await carregar(client, id, professorId);
  if (linha.status !== 'PUBLICADA') return;
  const pendencias = pendenciasDePublicacao(linha);
  if (pendencias.length) {
    throw new ErroApp(409, `A avaliação está publicada e precisa continuar válida: ${pendencias.join(' ')}`);
  }
}

// ---------------------------------------------------------------------------- consulta

// Filtros de situação: ATIVAS (rascunho + publicadas, o padrão), ou um status específico.
export async function listar(professorId, { busca = '', situacao = 'ATIVAS', pagina = 1, tamanho = 20 }) {
  const filtros = ['a.professor_id = $1', "a.status <> 'EXCLUIDA'"];
  const valores = [professorId];

  if (situacao === 'ATIVAS') {
    filtros.push("a.status IN ('RASCUNHO', 'PUBLICADA')");
  } else {
    valores.push(situacao);
    filtros.push(`a.status = $${valores.length}`);
  }
  if (busca.trim()) {
    valores.push(`%${busca.trim().toLowerCase()}%`);
    filtros.push(`lower(a.titulo) LIKE $${valores.length}`);
  }

  const { rows } = await query(
    `SELECT a.*, ${RESUMO}, count(*) OVER () AS total
       FROM avaliacao a
      WHERE ${filtros.join(' AND ')}
      ORDER BY a.data_inicio DESC, a.id DESC
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, tamanho, (pagina - 1) * tamanho],
  );

  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    avaliacoes: rows.map((linha) => formatar(linha)),
    total,
    pagina,
    tamanho,
    paginas: Math.max(1, Math.ceil(total / tamanho)),
  };
}

export async function detalhar(id, professorId) {
  const executor = { query };
  const linha = await carregar(executor, id, professorId);
  const avaliacao = formatar(linha, await carregarQuestoes(executor, id));
  avaliacao.turmas = await carregarTurmas(executor, id);
  return avaliacao;
}

// ------------------------------------------------------ vincular a turmas (RF07, UC07)

// UC07: disponibiliza a avaliação para uma ou mais turmas do próprio professor.
// A1 (nenhuma selecionada) é recusado pela validação da rota. A2 (já vinculada) é
// informado: se TODAS já estavam vinculadas, 409; se só algumas, vincula as novas e
// diz quais já estavam.
export async function vincularTurmas(id, professorId, turmaIds) {
  const jaVinculadas = await transacao(async (client) => {
    const avaliacao = await carregar(client, id, professorId, { travar: true });
    if (!['RASCUNHO', 'PUBLICADA'].includes(avaliacao.status)) {
      throw new ErroApp(409, 'Avaliação arquivada não pode ser vinculada a novas turmas.');
    }

    const { rows: turmas } = await client.query(
      'SELECT id, nome, situacao FROM turma WHERE id = ANY($1::int[]) AND professor_id = $2',
      [turmaIds, professorId],
    );
    // Turma inexistente e turma de outro professor: a mesma resposta.
    if (turmas.length !== turmaIds.length) {
      throw new ErroApp(400, 'Há turmas que não existem entre as suas.', { turmas: 'Turma não encontrada.' });
    }
    const inativas = turmas.filter((t) => t.situacao !== 'ATIVA');
    if (inativas.length) {
      throw new ErroApp(409, `Turma inativa não recebe avaliações: ${inativas.map((t) => t.nome).join(', ')}.`);
    }

    // Uma turma por avaliação (migração 012). A API continua recebendo uma lista para
    // não quebrar quem já chamava assim, mas recusa mais de uma em vez de aceitar e
    // ignorar o resto — silenciar a diferença faria o professor achar que vinculou três.
    if (turmas.length > 1) {
      throw new ErroApp(
        400,
        'Uma avaliação pertence a uma turma. Para aplicá-la em outra, duplique-a — as questões vêm do banco e podem ser reusadas.',
        { turmas: 'Escolha uma turma.' },
      );
    }

    const { rows: existentes } = await client.query(
      'SELECT turma_id FROM avaliacao_turma WHERE avaliacao_id = $1',
      [id],
    );
    const atual = existentes[0];
    if (atual) {
      if (atual.turma_id === turmas[0].id) {
        throw new ErroApp(409, `A avaliação já está disponibilizada para a turma ${turmas[0].nome}.`);
      }
      // TROCA de turma, em vez de recusar. Antes era preciso retirar e vincular de novo,
      // e entre os dois passos a prova ficava sem turma — publicada, ficava inválida
      // nesse intervalo. Numa operação só ela nunca passa por esse estado.
      //
      // Depois de iniciada, não: as provas feitas pertencem à turma em que foram feitas
      // (DT41), e trocar reescreveria a quem a avaliação foi aplicada.
      if (avaliacao.total_tentativas > 0) {
        throw new ErroApp(
          409,
          'Esta avaliação já foi iniciada por estudantes: a turma não pode mais ser trocada. ' +
            'Duplique-a para aplicar em outra turma.',
        );
      }
      await client.query(
        'UPDATE avaliacao_turma SET turma_id = $3, vinculado_em = now() WHERE avaliacao_id = $1 AND turma_id = $2',
        [id, atual.turma_id, turmas[0].id],
      );
      return [];
    }

    await client.query('INSERT INTO avaliacao_turma (avaliacao_id, turma_id) VALUES ($1, $2)', [id, turmas[0].id]);
    return [];
  });
  return { avaliacao: await detalhar(id, professorId), jaVinculadas };
}

// ------------------------------------------------------------------ criação (UC03)

export async function criar(professorId, dados) {
  // A visibilidade dos resultados é decidida aqui, junto com o resto (16/10/2026). Antes
  // só existia a rota própria, e o bloco só aparecia na tela depois da primeira prova
  // feita — quando o professor já estava na correção, com o botão de liberar à mão, e
  // não voltaria à aba de configurações para escolher o que seria mostrado.
  // Ausente = nada além da nota, que é o padrão das colunas (005_divulgacao_resultados).
  const d = dados.divulgacao ?? {};
  const { rows } = await query(
    `INSERT INTO avaliacao
       (professor_id, titulo, descricao, duracao_minutos, data_inicio, data_fim,
        monitoramento_ativo, limite_ocorrencias,
        mostrar_gabarito, mostrar_media_turma, mostrar_distribuicao, mostrar_questoes_destaque)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      professorId,
      dados.titulo,
      dados.descricao,
      dados.duracaoMinutos,
      dados.dataInicio,
      dados.dataFim,
      dados.monitoramentoAtivo,
      dados.limiteOcorrencias,
      d.gabarito ?? false,
      d.mediaTurma ?? false,
      d.distribuicao ?? false,
      d.questoesDestaque ?? false,
    ],
  );
  return detalhar(rows[0].id, professorId);
}

// ------------------------------------------------------ edição das informações (UC04)

export async function atualizar(id, professorId, dados) {
  await transacao(async (client) => {
    // FOR UPDATE: a verificação "ainda não iniciada" e a gravação acontecem sob a mesma
    // trava. A Etapa 6 deve travar a avaliação ao criar a tentativa (ver PROJECT_CONTEXT).
    exigirEditavel(await carregar(client, id, professorId, { travar: true }));

    // `COALESCE`, e não o valor direto: quem não mandar a divulgação não a altera. Sem
    // isso, salvar só o título desmarcaria tudo o que o professor tinha escolhido ver.
    const d = dados.divulgacao ?? {};
    await client.query(
      `UPDATE avaliacao
          SET titulo = $3, descricao = $4, duracao_minutos = $5, data_inicio = $6, data_fim = $7,
              monitoramento_ativo = $8, limite_ocorrencias = $9,
              mostrar_gabarito = COALESCE($10, mostrar_gabarito),
              mostrar_media_turma = COALESCE($11, mostrar_media_turma),
              mostrar_distribuicao = COALESCE($12, mostrar_distribuicao),
              mostrar_questoes_destaque = COALESCE($13, mostrar_questoes_destaque),
              atualizado_em = now()
        WHERE id = $1 AND professor_id = $2`,
      [
        id,
        professorId,
        dados.titulo,
        dados.descricao,
        dados.duracaoMinutos,
        dados.dataInicio,
        dados.dataFim,
        dados.monitoramentoAtivo,
        dados.limiteOcorrencias,
        d.gabarito ?? null,
        d.mediaTurma ?? null,
        d.distribuicao ?? null,
        d.questoesDestaque ?? null,
      ],
    );
    await exigirPublicadaValida(client, id, professorId);
  });
  return detalhar(id, professorId);
}

// ------------------------------------------------- questões da avaliação (P-01, RF05)

// Substitui a lista inteira, na ordem recebida. Cobre adicionar, remover, reordenar e
// ajustar a pontuação em uma única operação atômica.
export async function definirQuestoes(id, professorId, itens) {
  await transacao(async (client) => {
    exigirEditavel(await carregar(client, id, professorId, { travar: true }));

    const ids = itens.map((i) => i.questaoId);
    const { rows: encontradas } = await client.query(
      'SELECT id, situacao, pontuacao_padrao FROM questao WHERE id = ANY($1::int[]) AND professor_id = $2',
      [ids, professorId],
    );
    const porId = new Map(encontradas.map((q) => [q.id, q]));

    // Questão inexistente e questão de outro professor recebem a mesma resposta.
    const ausentes = ids.filter((qid) => !porId.has(qid));
    if (ausentes.length) {
      throw new ErroApp(400, 'Há questões que não existem no seu banco de questões.', {
        questoes: `Questões não encontradas: ${ausentes.join(', ')}.`,
      });
    }

    // Questão inativa que JÁ estava na avaliação pode permanecer (a publicação é que a
    // barra); o que não se permite é ACRESCENTAR uma questão inativa agora.
    const { rows: atuais } = await client.query('SELECT questao_id FROM avaliacao_questao WHERE avaliacao_id = $1', [id]);
    const jaVinculadas = new Set(atuais.map((r) => r.questao_id));
    const inativasNovas = ids.filter((qid) => porId.get(qid).situacao === 'INATIVA' && !jaVinculadas.has(qid));
    if (inativasNovas.length) {
      throw new ErroApp(400, 'Questões inativas não podem ser adicionadas. Reative-as no banco de questões.', {
        questoes: 'Há questões inativas entre as adicionadas.',
      });
    }

    // Os vínculos são regravados. Só ocorre com a avaliação ainda NÃO iniciada (checado
    // acima): nenhuma tentativa depende deles, então nada de histórico se perde (DT34).
    await client.query('DELETE FROM avaliacao_questao WHERE avaliacao_id = $1', [id]);
    for (const [indice, item] of itens.entries()) {
      await client.query(
        'INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao) VALUES ($1, $2, $3, $4)',
        [id, item.questaoId, indice + 1, item.pontuacao ?? porId.get(item.questaoId).pontuacao_padrao],
      );
    }
    await client.query('UPDATE avaliacao SET atualizado_em = now() WHERE id = $1', [id]);

    await exigirPublicadaValida(client, id, professorId);
  });
  return detalhar(id, professorId);
}

// ------------------------------------------------------------------ publicar (RN01)

// ------------------------------------------- editar uma questão DENTRO da avaliação
//
// Duas histórias diferentes, decididas por `no_banco`:
//
//   - questão escrita para ESTA prova (fora do banco) → edita no lugar. Ninguém mais a
//     usa, então não há o que preservar;
//   - questão DO BANCO → não é alterada. A prova recebe uma cópia própria, com as
//     mudanças, e passa a apontar para ela.
//
// A segunda regra é a que importa: o banco existe para ser reusado, e outras provas podem
// estar usando aquela questão neste exato momento. Editar "a questão da prova" e ver o
// texto mudar em provas que o professor nem abriu seria o pior tipo de surpresa.
//
// A cópia nasce FORA do banco, como qualquer questão escrita dentro de uma prova — e o
// professor pode promovê-la depois, pelo mesmo botão das outras.
//
// Tudo numa transação: gravar a cópia e trocar o vínculo têm de cair ou valer juntos,
// senão sobraria uma questão órfã, invisível no banco e em prova nenhuma.
export async function editarQuestaoDaProva(id, questaoId, professorId, dados) {
  await transacao(async (client) => {
    exigirEditavel(await carregar(client, id, professorId, { travar: true }));

    const { rows: vinculo } = await client.query(
      `SELECT aq.ordem, aq.pontuacao, aq.congelada_em, q.no_banco
         FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
        WHERE aq.avaliacao_id = $1 AND aq.questao_id = $2 AND q.professor_id = $3`,
      [id, questaoId, professorId],
    );
    if (!vinculo[0]) throw new ErroApp(404, 'Esta questão não faz parte desta avaliação.');
    // Congelada é cópia do que foi aplicado: mexer nela reescreveria a prova que os
    // estudantes fizeram. O `exigirEditavel` acima já barra, mas a prova não depende disso.
    if (vinculo[0].congelada_em !== null) {
      throw new ErroApp(409, 'Esta prova já foi aplicada e as questões dela não podem mais ser alteradas.');
    }

    if (vinculo[0].no_banco === false) {
      await regravarQuestao(client, questaoId, professorId, dados);
      return;
    }

    const novoId = await gravarQuestaoNova(client, professorId, dados, { noBanco: false });
    await client.query(
      'UPDATE avaliacao_questao SET questao_id = $3 WHERE avaliacao_id = $1 AND questao_id = $2',
      [id, questaoId, novoId],
    );
  });

  await exigirPublicadaValidaFora(id, professorId);
  return detalhar(id, professorId);
}

// A validação de "publicada continua válida" roda fora da transação acima porque precisa
// ler o estado já gravado.
async function exigirPublicadaValidaFora(id, professorId) {
  await transacao((client) => exigirPublicadaValida(client, id, professorId));
}

// --------------------------------------------------- divulgação dos resultados

// O professor escolhe o que o estudante vê além da nota. Pode mudar a qualquer momento,
// inclusive depois de liberar: é exibição, não altera nota, correção nem histórico — e
// por isso não cai no bloqueio estrutural de P-15a.
export async function definirDivulgacao(id, professorId, opcoes) {
  await transacao(async (client) => {
    await carregar(client, id, professorId, { travar: true });
    await client.query(
      `UPDATE avaliacao
          SET mostrar_gabarito = $3, mostrar_media_turma = $4,
              mostrar_distribuicao = $5, mostrar_questoes_destaque = $6, atualizado_em = now()
        WHERE id = $1 AND professor_id = $2`,
      [id, professorId, opcoes.gabarito, opcoes.mediaTurma, opcoes.distribuicao, opcoes.questoesDestaque],
    );
  });
  return detalhar(id, professorId);
}

export async function publicar(id, professorId) {
  await transacao(async (client) => {
    const linha = await carregar(client, id, professorId, { travar: true });
    if (linha.status !== 'RASCUNHO') {
      throw new ErroApp(409, 'Só avaliações em rascunho podem ser publicadas.');
    }
    const pendencias = pendenciasDePublicacao(linha);
    if (pendencias.length) {
      throw new ErroApp(409, `A avaliação ainda não pode ser publicada. ${pendencias.join(' ')}`, {
        publicacao: pendencias.join(' '),
      });
    }
    await client.query("UPDATE avaliacao SET status = 'PUBLICADA', atualizado_em = now() WHERE id = $1", [id]);
  });
  return detalhar(id, professorId);
}

// ------------------------------------------------------------------ arquivar (P-15a)

// Permitido mesmo depois de iniciada: é a forma de "tirar de circulação" uma avaliação
// com histórico, que não pode ser excluída.
export async function arquivar(id, professorId) {
  await transacao(async (client) => {
    const linha = await carregar(client, id, professorId, { travar: true });
    if (linha.status === 'ARQUIVADA') throw new ErroApp(409, 'A avaliação já está arquivada.');
    await client.query("UPDATE avaliacao SET status = 'ARQUIVADA', atualizado_em = now() WHERE id = $1", [id]);
  });
  return detalhar(id, professorId);
}

// ----------------------------------------------------- excluir = exclusão lógica (DT14)

// Só para avaliações que nenhum estudante iniciou (RF04: "que ainda não tenham sido
// respondidas"). A linha continua no banco com status EXCLUIDA e some das listagens.
export async function excluir(id, professorId) {
  await transacao(async (client) => {
    const linha = await carregar(client, id, professorId, { travar: true });
    if (linha.total_tentativas > 0) {
      throw new ErroApp(
        409,
        'Esta avaliação já foi iniciada por estudantes e não pode ser excluída, pois o histórico depende dela. ' +
          'Arquive-a para tirá-la de circulação.',
      );
    }
    await client.query("UPDATE avaliacao SET status = 'EXCLUIDA', atualizado_em = now() WHERE id = $1", [id]);
  });
  return { excluida: true };
}

// ------------------------------------------- modo de teste do professor (P-20, DT39)
//
// O professor faz a própria prova para conferi-la, como o estudante a veria. NADA é
// gravado: nenhuma linha em `tentativa`, `resposta` ou qualquer outra tabela. Por isso o
// teste nunca conta como "iniciada" (P-15a), nunca trava a avaliação e nunca aparece em
// resultados ou no dashboard. As duas funções abaixo só fazem SELECT.
//
// Como na prova real, o gabarito não vai para o navegador antes da entrega: a primeira
// função devolve as questões sem indicar a correta, e a correção acontece no servidor.

async function questoesParaTeste(id, professorId) {
  const executor = { query };
  const avaliacao = await carregar(executor, id, professorId);
  if (avaliacao.total_questoes === 0) {
    throw new ErroApp(409, 'Adicione ao menos uma questão para fazer o teste.');
  }
  const { rows: questoes } = await query(
    `SELECT aq.questao_id, aq.ordem, aq.pontuacao, q.tipo, q.enunciado,
            q.resposta_esperada, q.criterios_correcao
       FROM avaliacao_questao aq JOIN questao q ON q.id = aq.questao_id
      WHERE aq.avaliacao_id = $1
      ORDER BY aq.ordem`,
    [id],
  );
  const { rows: alternativas } = await query(
    `SELECT a.id, a.questao_id, a.ordem, a.texto, a.correta
       FROM alternativa a JOIN avaliacao_questao aq ON aq.questao_id = a.questao_id
      WHERE aq.avaliacao_id = $1
      ORDER BY a.questao_id, a.ordem`,
    [id],
  );
  return { avaliacao, questoes, alternativas };
}

// O que o estudante verá ao fazer a prova: sem gabarito, sem resposta esperada.
export async function prepararTeste(id, professorId) {
  const { avaliacao, questoes, alternativas } = await questoesParaTeste(id, professorId);
  return {
    id: avaliacao.id,
    titulo: avaliacao.titulo,
    descricao: avaliacao.descricao,
    duracaoMinutos: avaliacao.duracao_minutos,
    pontuacaoTotal: avaliacao.pontuacao_total,
    questoes: questoes.map((q) => ({
      questaoId: q.questao_id,
      ordem: q.ordem,
      tipo: q.tipo,
      enunciado: q.enunciado,
      pontuacao: q.pontuacao,
      alternativas: alternativas
        .filter((a) => a.questao_id === q.questao_id)
        .map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto })),
    })),
  };
}

// Corrige as respostas do teste. Mesma regra que a correção real usará (RF11):
// objetiva certa vale a pontuação da questão; errada ou em branco vale 0 (P-12).
// Discursiva não tem correção automática: devolve a referência para o professor comparar.
export async function corrigirTeste(id, professorId, respostas) {
  const { questoes, alternativas } = await questoesParaTeste(id, professorId);
  const porQuestao = new Map(questoes.map((q) => [q.questao_id, q]));

  // Resposta para questão que não está na prova, ou com alternativa de outra questão,
  // indica um cliente fora do fluxo normal: recusa em vez de corrigir errado.
  for (const r of respostas) {
    if (!porQuestao.has(r.questaoId)) {
      throw new ErroApp(400, 'Há respostas para questões que não fazem parte desta avaliação.');
    }
    if (r.alternativaId != null && !alternativas.some((a) => a.id === r.alternativaId && a.questao_id === r.questaoId)) {
      throw new ErroApp(400, 'Há uma alternativa que não pertence à questão respondida.');
    }
  }
  const resposta = new Map(respostas.map((r) => [r.questaoId, r]));

  let obtidaObjetivas = 0;
  let totalObjetivas = 0;
  let totalDiscursivas = 0;

  const itens = questoes.map((q) => {
    const r = resposta.get(q.questao_id);
    if (q.tipo === 'OBJETIVA') {
      const correta = alternativas.find((a) => a.questao_id === q.questao_id && a.correta);
      const marcada = r?.alternativaId ?? null;
      const acertou = marcada !== null && marcada === correta?.id;
      totalObjetivas += q.pontuacao;
      if (acertou) obtidaObjetivas += q.pontuacao;
      return {
        questaoId: q.questao_id,
        ordem: q.ordem,
        tipo: q.tipo,
        pontuacao: q.pontuacao,
        respondida: marcada !== null,
        alternativaMarcada: marcada,
        alternativaCorreta: correta?.id ?? null,
        acertou,
        pontosObtidos: acertou ? q.pontuacao : 0,
      };
    }
    totalDiscursivas += q.pontuacao;
    const texto = r?.texto?.trim() || '';
    return {
      questaoId: q.questao_id,
      ordem: q.ordem,
      tipo: q.tipo,
      pontuacao: q.pontuacao,
      respondida: texto.length > 0,
      texto,
      respostaEsperada: q.resposta_esperada,
      criteriosCorrecao: q.criterios_correcao,
      pontosObtidos: null, // depende da correção do professor (RF11)
    };
  });

  // Somas de NUMERIC em ponto flutuante: arredonda para as 2 casas do banco.
  const arredondar = (v) => Math.round(v * 100) / 100;
  return {
    itens,
    resumo: {
      pontosObjetivas: arredondar(obtidaObjetivas),
      totalObjetivas: arredondar(totalObjetivas),
      totalDiscursivas: arredondar(totalDiscursivas),
      pontuacaoTotal: arredondar(totalObjetivas + totalDiscursivas),
    },
  };
}

// ------------------------------------------------------------ duplicar (RF04, P-15a)

// Cria uma avaliação NOVA e independente, em rascunho, com as mesmas configurações e
// questões. É o caminho para reaproveitar uma avaliação já iniciada ou arquivada.
export async function duplicar(id, professorId) {
  const novoId = await transacao(async (client) => {
    const original = await carregar(client, id, professorId);
    const titulo = `${original.titulo} (cópia)`.slice(0, 200);

    const { rows } = await client.query(
      `INSERT INTO avaliacao
         (professor_id, titulo, descricao, duracao_minutos, data_inicio, data_fim,
          monitoramento_ativo, limite_ocorrencias)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        professorId,
        titulo,
        original.descricao,
        original.duracao_minutos,
        original.data_inicio,
        original.data_fim,
        original.monitoramento_ativo,
        original.limite_ocorrencias,
      ],
    );
    await client.query(
      `INSERT INTO avaliacao_questao (avaliacao_id, questao_id, ordem, pontuacao)
       SELECT $1, questao_id, ordem, pontuacao FROM avaliacao_questao WHERE avaliacao_id = $2`,
      [rows[0].id, id],
    );

    // A cópia herda a TURMA da original.
    //
    // Antes nascia sem turma, com o argumento de que a cópia costuma ser para outro
    // público. Isso era verdade enquanto existia uma listagem de avaliações onde encontrá-la
    // — hoje a prova só aparece dentro da turma, e uma cópia sem turma desaparece da
    // interface no instante em que o professor sai da tela. (Duas assim ficaram órfãs no
    // banco do autor antes desta correção.)
    //
    // Nascendo na mesma turma, ela fica visível ao lado da original, e trocar a turma é
    // uma escolha que o professor faz vendo o que criou — não uma pendência invisível.
    await client.query(
      `INSERT INTO avaliacao_turma (avaliacao_id, turma_id)
       SELECT $1, turma_id FROM avaliacao_turma WHERE avaliacao_id = $2`,
      [rows[0].id, id],
    );
    return rows[0].id;
  });
  return detalhar(novoId, professorId);
}
