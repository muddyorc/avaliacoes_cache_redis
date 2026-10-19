// RF05 — Gerenciar Questões (UC05). Banco de questões do professor.
//
// Regras que atravessam todo o módulo:
//   - Cada professor vê e altera SOMENTE as próprias questões. Questão de outro
//     professor responde 404, e não 403, para não revelar que ela existe.
//   - "Excluir" é inativar (Quadro 31: "Não permitido – inativação"; P-02).
//   - UC05 A1: questão em avaliação PUBLICADA **ainda não aplicada** não pode ser
//     inativada — essa prova ainda acompanha o banco e ficaria sem a questão.
//   - A questão pode ser **sempre editada** (P-22, 24/09/2026). A prova guarda a sua
//     própria cópia quando o primeiro estudante a inicia (migração 004), então mexer no
//     banco não altera prova já aplicada nem a correção do histórico. Isso substitui a
//     antiga P-16, que travava a questão inteira assim que alguém respondia.
//   - P-03 / P-13: objetiva tem alternativas e EXATAMENTE uma correta; discursiva não tem
//     alternativas e exige resposta esperada.
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';

const NAO_ENCONTRADA = 'Questão não encontrada.';

// Situação de uso da questão, calculada no banco. Alimenta UC05 A1 e permite à interface
// dizer onde a questão está sendo usada.
//
// "Respondida" = existe tentativa em alguma avaliação que contém a questão. Depois de
// P-22 isso não bloqueia mais nada: serve para a tela avisar que a questão já foi
// aplicada, e que editar o banco não muda a prova daqueles estudantes.
const USO = `
  EXISTS (
    SELECT 1 FROM avaliacao_questao aq
      JOIN tentativa t ON t.avaliacao_id = aq.avaliacao_id
     WHERE aq.questao_id = q.id
  ) AS respondida,
  EXISTS (
    SELECT 1 FROM avaliacao_questao aq
      JOIN avaliacao a ON a.id = aq.avaliacao_id
     WHERE aq.questao_id = q.id AND a.status = 'PUBLICADA' AND aq.congelada_em IS NULL
  ) AS em_avaliacao_publicada,
  (SELECT count(*)::int FROM avaliacao_questao aq WHERE aq.questao_id = q.id) AS avaliacoes_vinculadas`;

// Formato devolvido pela API. As alternativas só vêm no detalhe (`comAlternativas`).
function formatar(linha, alternativas) {
  const questao = {
    id: linha.id,
    tipo: linha.tipo,
    enunciado: linha.enunciado,
    tema: linha.tema,
    // P-26: objetiva em que o estudante marca todas as alternativas que julga corretas.
    multiplasCorretas: linha.multiplas_corretas ?? false,
    pontuacaoPadrao: linha.pontuacao_padrao,
    respostaEsperada: linha.resposta_esperada,
    criteriosCorrecao: linha.criterios_correcao,
    situacao: linha.situacao,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    uso: {
      respondida: linha.respondida,
      emAvaliacaoPublicada: linha.em_avaliacao_publicada,
      // A tela da prova usa isto para oferecer "Adicionar ao banco" só a quem ainda não
      // está lá. Botão que não faz nada é pior que botão ausente.
      noBanco: linha.no_banco !== false,
      avaliacoesVinculadas: linha.avaliacoes_vinculadas,
      // Resumo pronto para a interface: o que pode ser feito agora com a questão.
      // Editar é sempre possível (P-22); inativar só não vale enquanto uma avaliação
      // publicada ainda depender do banco (UC05 A1).
      podeEditar: true,
      podeInativar: !linha.em_avaliacao_publicada,
    },
  };
  if (linha.total_alternativas !== undefined) questao.totalAlternativas = linha.total_alternativas;
  if (alternativas) {
    questao.alternativas = alternativas.map((a) => ({ id: a.id, ordem: a.ordem, texto: a.texto, correta: a.correta }));
  }
  return questao;
}

// Busca a questão garantindo a PROPRIEDADE. Usada por todas as operações sobre uma questão.
async function carregar(executor, id, professorId, { travar = false } = {}) {
  const { rows } = await executor.query(
    `SELECT q.*, ${USO}
       FROM questao q
      WHERE q.id = $1 AND q.professor_id = $2
      ${travar ? 'FOR UPDATE OF q' : ''}`,
    [id, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
  return rows[0];
}

async function carregarAlternativas(executor, questaoId) {
  const { rows } = await executor.query(
    'SELECT id, ordem, texto, correta FROM alternativa WHERE questao_id = $1 ORDER BY ordem',
    [questaoId],
  );
  return rows;
}

// Grava as alternativas na ordem recebida. Discursivas chegam com a lista vazia.
async function inserirAlternativas(client, questaoId, alternativas) {
  for (const [indice, alternativa] of alternativas.entries()) {
    await client.query(
      'INSERT INTO alternativa (questao_id, ordem, texto, correta) VALUES ($1, $2, $3, $4)',
      [questaoId, indice + 1, alternativa.texto, alternativa.correta],
    );
  }
}

// Campos exclusivos de um tipo são descartados no outro: uma objetiva não guarda
// "resposta esperada" e uma discursiva não guarda alternativas.
function normalizar(dados) {
  const objetiva = dados.tipo === 'OBJETIVA';
  return {
    tipo: dados.tipo,
    enunciado: dados.enunciado,
    tema: dados.tema || null,
    pontuacaoPadrao: dados.pontuacaoPadrao,
    respostaEsperada: objetiva ? null : dados.respostaEsperada,
    criteriosCorrecao: objetiva ? null : dados.criteriosCorrecao || null,
    alternativas: objetiva ? dados.alternativas : [],
    // Só objetiva tem alternativas, logo só objetiva pode aceitar várias corretas.
    multiplasCorretas: objetiva ? Boolean(dados.multiplasCorretas) : false,
  };
}

// ---------------------------------------------------------------------------- consulta

// "Organizar" (RF05): filtros por tipo, tema, situação e texto do enunciado.
export async function listar(professorId, { busca = '', tipo, tema, situacao = 'ATIVA', pagina = 1, tamanho = 20 }) {
  // `q.no_banco`: a questão escrita dentro de uma prova e não promovida não aparece
  // aqui. O banco existe para reuso, e lotará-lo de questões de uso único o tornaria
  // inútil pelo excesso.
  const filtros = ['q.professor_id = $1', 'q.no_banco'];
  const valores = [professorId];

  if (busca.trim()) {
    valores.push(`%${busca.trim().toLowerCase()}%`);
    filtros.push(`lower(q.enunciado) LIKE $${valores.length}`);
  }
  if (tipo) {
    valores.push(tipo);
    filtros.push(`q.tipo = $${valores.length}`);
  }
  if (tema) {
    valores.push(tema.trim().toLowerCase());
    filtros.push(`lower(q.tema) = $${valores.length}`);
  }
  // 'TODAS' dispensa o filtro; o padrão mostra só as ativas, que são as utilizáveis.
  if (situacao !== 'TODAS') {
    valores.push(situacao);
    filtros.push(`q.situacao = $${valores.length}`);
  }

  const { rows } = await query(
    `SELECT q.*, ${USO},
            (SELECT count(*)::int FROM alternativa al WHERE al.questao_id = q.id) AS total_alternativas,
            count(*) OVER () AS total
       FROM questao q
      WHERE ${filtros.join(' AND ')}
      ORDER BY q.atualizado_em DESC, q.id DESC
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, tamanho, (pagina - 1) * tamanho],
  );

  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    questoes: rows.map((linha) => formatar(linha)),
    total,
    pagina,
    tamanho,
    paginas: Math.max(1, Math.ceil(total / tamanho)),
  };
}

// Temas já usados pelo professor, para o filtro e para sugerir ao digitar.
// Agrupa sem diferenciar maiúsculas: "Álgebra" e "álgebra" são o mesmo tema.
export async function listarTemas(professorId) {
  const { rows } = await query(
    `SELECT min(tema) AS tema
       FROM questao
      WHERE professor_id = $1 AND tema IS NOT NULL
      GROUP BY lower(tema)
      ORDER BY lower(min(tema))`,
    [professorId],
  );
  return rows.map((r) => r.tema);
}

export async function detalhar(id, professorId) {
  const linha = await carregar({ query }, id, professorId);
  return formatar(linha, await carregarAlternativas({ query }, id));
}

// ------------------------------------------------------------------------------ criação

// `noBanco` decide se a questão entra no banco de reuso (RF05) ou se existe só para a
// prova em que foi escrita. Criada pela tela do banco → vai para o banco; criada dentro de
// uma avaliação → fica fora até o professor promovê-la.
//
// O padrão é TRUE: quem chama sem dizer nada está cadastrando no banco, que é o que a
// rota do banco sempre fez.
export async function criar(professorId, dados, { noBanco = true } = {}) {
  const id = await transacao((client) => gravarQuestaoNova(client, professorId, dados, { noBanco }));
  return detalhar(id, professorId);
}

// --------------------------------------------- escritores reaproveitáveis (transação)
//
// Recebem o `client` de uma transação já aberta, para que outro módulo possa gravar
// questões dentro da própria transação dele — é o que a edição de uma questão DENTRO da
// avaliação precisa, já que lá a gravação e a troca do vínculo têm de cair ou valer juntas.
//
// A SQL mora aqui, e não duplicada no outro módulo: quem muda o formato de uma questão
// muda um lugar só.

export async function gravarQuestaoNova(client, professorId, dados, { noBanco = true } = {}) {
  const q = normalizar(dados);
  const { rows } = await client.query(
    `INSERT INTO questao
       (professor_id, tipo, enunciado, tema, pontuacao_padrao, resposta_esperada, criterios_correcao,
        multiplas_corretas, no_banco)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [professorId, q.tipo, q.enunciado, q.tema, q.pontuacaoPadrao, q.respostaEsperada, q.criteriosCorrecao,
     q.multiplasCorretas, noBanco],
  );
  await inserirAlternativas(client, rows[0].id, q.alternativas);
  return rows[0].id;
}

export async function regravarQuestao(client, id, professorId, dados) {
  const q = normalizar(dados);
  await carregar(client, id, professorId, { travar: true });
  await client.query(
    `UPDATE questao
        SET tipo = $3, enunciado = $4, tema = $5, pontuacao_padrao = $6,
            resposta_esperada = $7, criterios_correcao = $8, multiplas_corretas = $9,
            atualizado_em = now()
      WHERE id = $1 AND professor_id = $2`,
    [id, professorId, q.tipo, q.enunciado, q.tema, q.pontuacaoPadrao, q.respostaEsperada, q.criteriosCorrecao,
     q.multiplasCorretas],
  );
  // As alternativas são regravadas por inteiro (DT31). Nenhum histórico se perde: a prova
  // já aplicada tem a própria cópia das alternativas e do gabarito (P-22).
  await client.query('DELETE FROM alternativa WHERE questao_id = $1', [id]);
  await inserirAlternativas(client, id, q.alternativas);
}

// ------------------------------------------------------------------------------ edição

export async function atualizar(id, professorId, dados) {
  // FOR UPDATE dentro de `regravarQuestao`: impede duas edições simultâneas da mesma
  // questão de se atropelarem.
  await transacao((client) => regravarQuestao(client, id, professorId, dados));
  return detalhar(id, professorId);
}

// ------------------------------------------------------------ reutilização: duplicar

// Serve para criar variações de uma questão existente ("reutilizar", RF05). A cópia é
// independente e nasce ativa, sem nenhum vínculo com avaliações. Deixou de ser a única
// saída para alterar uma questão aplicada: com P-22, editar o original é permitido.
export async function duplicar(id, professorId) {
  const novoId = await transacao(async (client) => {
    const original = await carregar(client, id, professorId);
    const alternativas = await carregarAlternativas(client, id);

    const { rows } = await client.query(
      `INSERT INTO questao
         (professor_id, tipo, enunciado, tema, pontuacao_padrao, resposta_esperada, criterios_correcao,
          multiplas_corretas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        professorId,
        original.tipo,
        original.enunciado,
        original.tema,
        original.pontuacao_padrao,
        original.resposta_esperada,
        original.criterios_correcao,
        original.multiplas_corretas,
      ],
    );
    await inserirAlternativas(client, rows[0].id, alternativas);
    return rows[0].id;
  });
  return detalhar(novoId, professorId);
}

// Promove ao banco uma questão que nasceu dentro de uma prova.
//
// Sem volta por aqui de propósito: tirar do banco seria "despromover", e a questão pode
// já estar em outras provas a essa altura. Para sumir do banco existe inativar (P-02),
// que é a operação pensada para isso e já protege o que está em uso.
export async function promoverAoBanco(id, professorId) {
  const { rowCount } = await query(
    'UPDATE questao SET no_banco = TRUE, atualizado_em = now() WHERE id = $1 AND professor_id = $2 AND NOT no_banco',
    [id, professorId],
  );
  if (rowCount === 0) {
    // Ou não é dele, ou não existe, ou já está no banco. Conferir qual para responder
    // com precisão — "já está lá" não é erro do professor.
    const { rows } = await query('SELECT no_banco FROM questao WHERE id = $1 AND professor_id = $2', [id, professorId]);
    if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
    throw new ErroApp(409, 'Esta questão já está no seu banco de questões.');
  }
  return detalhar(id, professorId);
}

// ---------------------------------------------------- "excluir" = inativar (Quadro 31)

export async function alterarSituacao(id, professorId, situacao) {
  await transacao(async (client) => {
    const atual = await carregar(client, id, professorId, { travar: true });

    if (situacao === 'INATIVA') {
      // UC05 A1 — texto do próprio DERS: o sistema impede e informa a restrição.
      if (atual.em_avaliacao_publicada) {
        throw new ErroApp(
          409,
          'Esta questão faz parte de uma avaliação publicada que ainda não foi aplicada, ' +
            'e não pode ser excluída. Provas já aplicadas guardam a própria cópia e não são afetadas.',
        );
      }
    }

    await client.query(
      'UPDATE questao SET situacao = $3, atualizado_em = now() WHERE id = $1 AND professor_id = $2',
      [id, professorId, situacao],
    );
  });
  return detalhar(id, professorId);
}
