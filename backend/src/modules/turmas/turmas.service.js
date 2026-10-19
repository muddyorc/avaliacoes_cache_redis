// RF06 — Gerenciar Turmas (UC06).
//
// Regras que atravessam o módulo:
//   - Cada professor administra SOMENTE as próprias turmas (a de outro responde 404).
//   - O sistema gera o código de acesso (UC06, passo 7). O estudante entra por ele (A2)
//     de forma direta ou mediante aprovação, conforme a turma (P-09, A3, A4).
//   - Turma não é apagada: é inativada (Quadro 31). Turma inativa não aceita novas
//     entradas nem novos vínculos com avaliações; o que já existe é preservado.
//   - Nenhum vínculo de estudante é apagado: aprovar, recusar e aprovar uma recusa
//     apenas mudam a `situacao` da linha em `turma_estudante`.
import crypto from 'node:crypto';
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';
import { listarDaTurma } from '../realizacao/realizacao.service.js';

const NAO_ENCONTRADA = 'Turma não encontrada.';

// Sem 0/O, 1/I/L: o código é ditado em sala e digitado no celular, então caracteres
// parecidos gerariam erros de digitação. 31 símbolos em 8 posições ≈ 8,5 × 10¹¹
// combinações — inviável de adivinhar, ainda mais com o limite de tentativas da rota.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 8;

export function gerarCodigo() {
  let codigo = '';
  for (let i = 0; i < TAMANHO_CODIGO; i += 1) codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return codigo;
}

// Aceita o código como a pessoa digitar: minúsculas, espaços e hífen são ignorados.
export function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const VIOLACAO_UNICIDADE = '23505';

// Colisão de código é praticamente impossível, mas é tratada: tenta de novo.
// Dentro de uma transação, uma violação de unicidade aborta a transação inteira; o
// SAVEPOINT isola cada tentativa para que a seguinte possa rodar.
async function comCodigoUnico(executor, operacao, { emTransacao = false } = {}) {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    if (emTransacao) await executor.query('SAVEPOINT codigo_turma');
    try {
      const resultado = await operacao(gerarCodigo());
      if (emTransacao) await executor.query('RELEASE SAVEPOINT codigo_turma');
      return resultado;
    } catch (erro) {
      if (emTransacao) await executor.query('ROLLBACK TO SAVEPOINT codigo_turma');
      if (erro.code !== VIOLACAO_UNICIDADE || !/codigo_acesso/.test(erro.constraint ?? '')) throw erro;
    }
  }
  throw new Error('Não foi possível gerar um código de acesso único.');
}

const RESUMO = `
  (SELECT count(*)::int FROM turma_estudante te WHERE te.turma_id = t.id AND te.situacao = 'APROVADA') AS total_estudantes,
  (SELECT count(*)::int FROM turma_estudante te WHERE te.turma_id = t.id AND te.situacao = 'PENDENTE') AS total_pendentes,
  (SELECT count(*)::int FROM avaliacao_turma at JOIN avaliacao a ON a.id = at.avaliacao_id
    WHERE at.turma_id = t.id AND a.status <> 'EXCLUIDA') AS total_avaliacoes`;

function formatar(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    codigoAcesso: linha.codigo_acesso,
    requerAprovacao: linha.requer_aprovacao,
    situacao: linha.situacao,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
    totalEstudantes: linha.total_estudantes,
    totalPendentes: linha.total_pendentes,
    totalAvaliacoes: linha.total_avaliacoes,
  };
}

async function carregar(executor, id, professorId, { travar = false } = {}) {
  const { rows } = await executor.query(
    `SELECT t.*, ${RESUMO} FROM turma t WHERE t.id = $1 AND t.professor_id = $2 ${travar ? 'FOR UPDATE OF t' : ''}`,
    [id, professorId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
  return rows[0];
}

// ------------------------------------------------------------------ professor: consulta

export async function listar(professorId, { busca = '', situacao = 'ATIVA' }) {
  const filtros = ['t.professor_id = $1'];
  const valores = [professorId];
  if (situacao !== 'TODAS') {
    valores.push(situacao);
    filtros.push(`t.situacao = $${valores.length}`);
  }
  if (busca.trim()) {
    valores.push(`%${busca.trim().toLowerCase()}%`);
    filtros.push(`lower(t.nome) LIKE $${valores.length}`);
  }
  const { rows } = await query(
    `SELECT t.*, ${RESUMO} FROM turma t WHERE ${filtros.join(' AND ')} ORDER BY lower(t.nome), t.id`,
    valores,
  );
  return { turmas: rows.map(formatar) };
}

// Detalhe com estudantes, solicitações e avaliações vinculadas. O professor vê nome e
// e-mail dos estudantes: o mínimo para identificá-los (RNF21).
export async function detalhar(id, professorId) {
  const turma = formatar(await carregar({ query }, id, professorId));

  const { rows: membros } = await query(
    `SELECT u.id, u.nome, u.email, u.situacao AS situacao_conta, te.situacao, te.solicitado_em, te.decidido_em
       FROM turma_estudante te JOIN usuario u ON u.id = te.estudante_id
      WHERE te.turma_id = $1
      ORDER BY lower(u.nome)`,
    [id],
  );
  const pessoa = (m) => ({
    id: m.id,
    nome: m.nome,
    email: m.email,
    contaAtiva: m.situacao_conta === 'ATIVO',
    solicitadoEm: m.solicitado_em,
    decididoEm: m.decidido_em,
  });

  // A tela da turma passou a ser o lugar das provas (15/10/2026): a listagem separada de
  // avaliações deixou de existir, porque a prova agora pertence a uma turma. Por isso
  // aqui vai o que a lista precisa mostrar — quantas questões, quanto vale, quantos já
  // fizeram —, e não só título e datas.
  const { rows: avaliacoes } = await query(
    `SELECT a.id, a.titulo, a.status, a.data_inicio, a.data_fim, a.resultados_liberados, at.vinculado_em,
            (SELECT count(*)::int FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id) AS total_questoes,
            (SELECT coalesce(sum(aq.pontuacao), 0) FROM avaliacao_questao aq WHERE aq.avaliacao_id = a.id)
              AS pontuacao_total,
            (SELECT count(*)::int FROM tentativa t WHERE t.avaliacao_id = a.id) AS total_tentativas,
            (SELECT count(*)::int FROM tentativa t
              WHERE t.avaliacao_id = a.id AND t.status <> 'EM_ANDAMENTO' AND NOT t.correcao_concluida)
              AS aguardando_correcao
       FROM avaliacao_turma at JOIN avaliacao a ON a.id = at.avaliacao_id
      WHERE at.turma_id = $1 AND a.status <> 'EXCLUIDA'
      ORDER BY a.data_inicio DESC`,
    [id],
  );

  return {
    ...turma,
    estudantes: membros.filter((m) => m.situacao === 'APROVADA').map(pessoa),
    pendentes: membros.filter((m) => m.situacao === 'PENDENTE').map(pessoa),
    recusados: membros.filter((m) => m.situacao === 'RECUSADA').map(pessoa),
    avaliacoes: avaliacoes.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      status: a.status,
      dataInicio: a.data_inicio,
      dataFim: a.data_fim,
      vinculadoEm: a.vinculado_em,
      totalQuestoes: a.total_questoes,
      pontuacaoTotal: Number(a.pontuacao_total),
      totalTentativas: a.total_tentativas,
      aguardandoCorrecao: a.aguardando_correcao,
      resultadosLiberados: a.resultados_liberados,
    })),
  };
}

// ------------------------------------------------------------ professor: criar e editar

export async function criar(professorId, { nome, descricao, requerAprovacao }) {
  const id = await comCodigoUnico({ query }, async (codigo) => {
    const { rows } = await query(
      `INSERT INTO turma (professor_id, nome, descricao, codigo_acesso, requer_aprovacao)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [professorId, nome, descricao, codigo, requerAprovacao],
    );
    return rows[0].id;
  });
  return detalhar(id, professorId);
}

export async function atualizar(id, professorId, { nome, descricao, requerAprovacao }) {
  await transacao(async (client) => {
    const atual = await carregar(client, id, professorId, { travar: true });
    if (atual.situacao === 'INATIVA') {
      throw new ErroApp(409, 'Turma inativa não pode ser alterada. Reative-a primeiro.');
    }
    // Trocar para entrada direta não aprova quem já estava pendente: essas pessoas
    // continuam aguardando a decisão do professor, que as conhece pelo nome.
    await client.query(
      `UPDATE turma SET nome = $3, descricao = $4, requer_aprovacao = $5, atualizado_em = now()
        WHERE id = $1 AND professor_id = $2`,
      [id, professorId, nome, descricao, requerAprovacao],
    );
  });
  return detalhar(id, professorId);
}

// Novo código: o anterior deixa de valer na hora. Útil se o código vazou para fora da
// turma. Quem já entrou continua na turma.
export async function gerarNovoCodigo(id, professorId) {
  await transacao(async (client) => {
    const atual = await carregar(client, id, professorId, { travar: true });
    if (atual.situacao === 'INATIVA') throw new ErroApp(409, 'Turma inativa não aceita novas entradas.');
    await comCodigoUnico(
      client,
      (codigo) => client.query('UPDATE turma SET codigo_acesso = $2, atualizado_em = now() WHERE id = $1', [id, codigo]),
      { emTransacao: true },
    );
  });
  return detalhar(id, professorId);
}

// "Excluir" = inativar (Quadro 31). Estudantes, solicitações e vínculos com avaliações
// são preservados; a turma só deixa de aceitar entradas e novos vínculos.
export async function alterarSituacao(id, professorId, situacao) {
  await transacao(async (client) => {
    await carregar(client, id, professorId, { travar: true });
    await client.query('UPDATE turma SET situacao = $2, atualizado_em = now() WHERE id = $1', [id, situacao]);
  });
  return detalhar(id, professorId);
}

// ------------------------------------------------- professor: decidir solicitações (A3/A4)

export async function decidir(id, professorId, estudanteId, decisao) {
  await transacao(async (client) => {
    await carregar(client, id, professorId, { travar: true });
    const { rows } = await client.query(
      'SELECT situacao FROM turma_estudante WHERE turma_id = $1 AND estudante_id = $2 FOR UPDATE',
      [id, estudanteId],
    );
    const atual = rows[0]?.situacao;
    if (!atual) throw new ErroApp(404, 'Solicitação não encontrada nesta turma.');

    if (decisao === 'APROVADA' && atual === 'APROVADA') {
      throw new ErroApp(409, 'Este estudante já participa da turma.');
    }
    // Recusar só vale para quem está aguardando. Tirar da turma quem já foi aprovado
    // não é previsto pelo DERS e apagaria o histórico do vínculo (DT43).
    if (decisao === 'RECUSADA' && atual !== 'PENDENTE') {
      throw new ErroApp(409, 'Só é possível recusar solicitações pendentes.');
    }
    // Aprovar uma recusa é permitido: corrige um engano sem o estudante pedir de novo.
    await client.query(
      'UPDATE turma_estudante SET situacao = $3, decidido_em = now() WHERE turma_id = $1 AND estudante_id = $2',
      [id, estudanteId, decisao],
    );
  });
  return detalhar(id, professorId);
}

// ------------------------------------------------------------------ estudante (A2/A3)

// Resultado claro para cada caso, sem revelar dados de turmas das quais o estudante
// não participa: código inválido e turma inativa recebem a MESMA mensagem.
export async function entrarComCodigo(estudanteId, codigoDigitado) {
  const codigo = normalizarCodigo(codigoDigitado);
  const INVALIDO = 'Código de turma inválido. Confira com o professor.';
  if (codigo.length !== TAMANHO_CODIGO) throw new ErroApp(400, INVALIDO, { codigo: INVALIDO });

  return transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.nome, t.requer_aprovacao, t.situacao, u.nome AS professor
         FROM turma t JOIN usuario u ON u.id = t.professor_id
        WHERE t.codigo_acesso = $1`,
      [codigo],
    );
    const turma = rows[0];
    if (!turma || turma.situacao !== 'ATIVA') throw new ErroApp(404, INVALIDO, { codigo: INVALIDO });

    const { rows: existente } = await client.query(
      'SELECT situacao FROM turma_estudante WHERE turma_id = $1 AND estudante_id = $2 FOR UPDATE',
      [turma.id, estudanteId],
    );
    const situacaoAtual = existente[0]?.situacao;

    if (situacaoAtual === 'APROVADA') throw new ErroApp(409, `Você já participa da turma "${turma.nome}".`);
    if (situacaoAtual === 'PENDENTE') {
      throw new ErroApp(409, `Sua solicitação para "${turma.nome}" já está aguardando o professor.`);
    }
    // A4: a recusa é definitiva do lado do estudante; só o professor pode revertê-la.
    // Sem isso, o estudante recusado poderia insistir indefinidamente.
    if (situacaoAtual === 'RECUSADA') {
      throw new ErroApp(409, `Sua solicitação para "${turma.nome}" foi recusada. Procure o professor.`);
    }

    const situacao = turma.requer_aprovacao ? 'PENDENTE' : 'APROVADA';
    const decididoEm = situacao === 'APROVADA' ? new Date() : null;
    // Quem já saiu pode voltar com o código: a linha antiga continua lá (P-24), então
    // entrar de novo atualiza o vínculo em vez de criar outro. Volta pelo mesmo caminho
    // de quem nunca participou — com aprovação, se a turma exigir.
    await client.query(
      `INSERT INTO turma_estudante (turma_id, estudante_id, situacao, solicitado_em, decidido_em)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (turma_id, estudante_id) DO UPDATE
          SET situacao = EXCLUDED.situacao,
              solicitado_em = now(),
              decidido_em = EXCLUDED.decidido_em,
              saiu_em = NULL`,
      [turma.id, estudanteId, situacao, decididoEm],
    );

    return {
      turma: { id: turma.id, nome: turma.nome, professor: turma.professor },
      situacao,
      mensagem:
        situacao === 'APROVADA'
          ? `Você entrou na turma "${turma.nome}".`
          : `Solicitação enviada. Aguarde o professor aprovar sua entrada em "${turma.nome}".`,
    };
  });
}

// P-24 — o estudante cancela a própria inscrição.
//
// Sair é exclusão lógica: a linha do vínculo fica, com `situacao = 'SAIU'` e a data. O
// que ele já fez na turma continua existindo — as provas guardam a própria turma (DT72),
// então o professor não perde nota nem estatística de quem saiu.
//
// Prova em andamento bloqueia a saída: sair no meio da prova deixaria uma tentativa viva
// numa turma que o estudante não integra mais, e o caminho certo ali é entregar.
export async function sairDaTurma(turmaId, estudanteId) {
  return transacao(async (client) => {
    const { rows } = await client.query(
      `SELECT te.situacao, t.nome
         FROM turma_estudante te JOIN turma t ON t.id = te.turma_id
        WHERE te.turma_id = $1 AND te.estudante_id = $2
        FOR UPDATE OF te`,
      [turmaId, estudanteId],
    );
    const vinculo = rows[0];
    // Mesmo 404 de quem pede uma turma que não existe: a resposta não confirma turma alheia.
    if (!vinculo) throw new ErroApp(404, 'Turma não encontrada.');
    if (vinculo.situacao === 'SAIU') {
      throw new ErroApp(409, `Você já não participa da turma "${vinculo.nome}".`);
    }
    if (vinculo.situacao === 'RECUSADA') {
      throw new ErroApp(409, 'Sua solicitação foi recusada pelo professor; não há inscrição para cancelar.');
    }

    const { rows: emAndamento } = await client.query(
      `SELECT a.titulo
         FROM tentativa t
         JOIN avaliacao a ON a.id = t.avaliacao_id
         JOIN avaliacao_turma at ON at.avaliacao_id = a.id AND at.turma_id = $1
        WHERE t.estudante_id = $2 AND t.status = 'EM_ANDAMENTO'
        LIMIT 1`,
      [turmaId, estudanteId],
    );
    if (emAndamento[0]) {
      throw new ErroApp(
        409,
        `Você está com a prova "${emAndamento[0].titulo}" em andamento nesta turma. Entregue-a antes de sair.`,
      );
    }

    await client.query(
      `UPDATE turma_estudante SET situacao = 'SAIU', saiu_em = now()
        WHERE turma_id = $1 AND estudante_id = $2`,
      [turmaId, estudanteId],
    );

    return {
      turma: { id: turmaId, nome: vinculo.nome },
      pendente: vinculo.situacao === 'PENDENTE',
      mensagem:
        vinculo.situacao === 'PENDENTE'
          ? `Solicitação para "${vinculo.nome}" cancelada.`
          : `Você saiu da turma "${vinculo.nome}". As provas que já fez continuam registradas com o professor.`,
    };
  });
}

// Uma turma vista pelo estudante: os dados da turma e as avaliações vinculadas a ela.
//
// Quem não tem vínculo recebe 404 — o mesmo que receberia se a turma não existisse, para
// a resposta não revelar a existência de turma alheia. Vínculo pendente ou recusado vê a
// turma e a situação, mas não a lista de provas: o acesso às avaliações depende de estar
// APROVADO, e quem decide isso é a mesma regra da realização da prova.
export async function detalharParaEstudante(turmaId, estudanteId) {
  const { rows } = await query(
    `SELECT t.id, t.nome, t.descricao, t.situacao AS situacao_turma, u.nome AS professor,
            te.situacao, te.solicitado_em, te.decidido_em
       FROM turma_estudante te
       JOIN turma t ON t.id = te.turma_id
       JOIN usuario u ON u.id = t.professor_id
      WHERE te.turma_id = $1 AND te.estudante_id = $2 AND te.situacao <> 'SAIU'`,
    [turmaId, estudanteId],
  );
  if (!rows[0]) throw new ErroApp(404, NAO_ENCONTRADA);
  const linha = rows[0];
  const aprovado = linha.situacao === 'APROVADA';

  const { avaliacoes, horaServidor } = aprovado
    ? await listarDaTurma(estudanteId, turmaId)
    : { avaliacoes: [], horaServidor: new Date().toISOString() };

  // Quem mais está na turma (16/10/2026). Só para quem está APROVADO, pela mesma regra
  // que vale para as provas: pedido pendente ainda não dá acesso ao conteúdo da turma.
  //
  // **Nome, e não e-mail.** O professor vê o e-mail porque precisa identificar quem é
  // quem para aprovar, corrigir e remover; entre colegas, o e-mail não serve a nada que
  // a tela ofereça e seria dado pessoal distribuído para a turma inteira.
  const { rows: colegas } = aprovado
    ? await query(
        `SELECT u.id, u.nome
           FROM turma_estudante te JOIN usuario u ON u.id = te.estudante_id
          WHERE te.turma_id = $1 AND te.situacao = 'APROVADA'
          ORDER BY lower(u.nome)`,
        [turmaId],
      )
    : { rows: [] };

  return {
    // `voce` marca a própria linha: numa turma com homônimos, é o que diz qual é a sua.
    colegas: colegas.map((c) => ({ id: c.id, nome: c.nome, voce: c.id === estudanteId })),
    turma: {
      id: linha.id,
      nome: linha.nome,
      descricao: linha.descricao,
      professor: linha.professor,
      turmaAtiva: linha.situacao_turma === 'ATIVA',
      situacao: linha.situacao,
      solicitadoEm: linha.solicitado_em,
      decididoEm: linha.decidido_em,
    },
    avaliacoes,
    horaServidor,
  };
}

// O professor remove um estudante da turma.
//
// Mesmo mecanismo da saída voluntária (migração 007): exclusão lógica, com a linha
// permanecendo e `situacao = 'SAIU'`. O que diferencia é `removido_por`, que guarda quem
// encerrou o vínculo — é por ele que cada lado recebe o texto certo, em vez de o
// estudante ler "você saiu" sobre algo que ele não fez.
//
// Prova em andamento bloqueia, como bloqueia a saída por conta própria: remover no meio
// da prova deixaria uma tentativa viva numa turma que a pessoa não integra mais. A
// mensagem aqui é para o professor, e diz o que ele pode fazer a respeito.
export async function removerEstudante(turmaId, estudanteId, professorId) {
  return transacao(async (client) => {
    // A turma precisa ser dele. Mesmo 404 de turma inexistente: a resposta não confirma
    // a existência de turma alheia.
    const { rows: turmas } = await client.query(
      'SELECT id, nome FROM turma WHERE id = $1 AND professor_id = $2',
      [turmaId, professorId],
    );
    if (!turmas[0]) throw new ErroApp(404, 'Turma não encontrada.');

    const { rows } = await client.query(
      `SELECT te.situacao, u.nome
         FROM turma_estudante te JOIN usuario u ON u.id = te.estudante_id
        WHERE te.turma_id = $1 AND te.estudante_id = $2
        FOR UPDATE OF te`,
      [turmaId, estudanteId],
    );
    const vinculo = rows[0];
    if (!vinculo) throw new ErroApp(404, 'Este estudante não participa desta turma.');
    if (vinculo.situacao === 'SAIU') {
      throw new ErroApp(409, `${vinculo.nome} já não participa desta turma.`);
    }

    const { rows: emAndamento } = await client.query(
      `SELECT a.titulo
         FROM tentativa t
         JOIN avaliacao a ON a.id = t.avaliacao_id
         JOIN avaliacao_turma at ON at.avaliacao_id = a.id AND at.turma_id = $1
        WHERE t.estudante_id = $2 AND t.status = 'EM_ANDAMENTO'
        LIMIT 1`,
      [turmaId, estudanteId],
    );
    if (emAndamento[0]) {
      throw new ErroApp(
        409,
        `${vinculo.nome} está com a prova "${emAndamento[0].titulo}" em andamento. ` +
          'Aguarde a entrega ou o fim do prazo para remover.',
      );
    }

    await client.query(
      `UPDATE turma_estudante
          SET situacao = 'SAIU', saiu_em = now(), removido_por = $3
        WHERE turma_id = $1 AND estudante_id = $2`,
      [turmaId, estudanteId, professorId],
    );

    return {
      estudante: { id: estudanteId, nome: vinculo.nome },
      turma: { id: turmaId, nome: turmas[0].nome },
      // O vínculo era só um pedido: não havia participação a encerrar.
      eraPendente: vinculo.situacao === 'PENDENTE',
    };
  });
}

// As turmas do estudante, com a situação de cada uma. Não inclui o código de acesso nem
// dados de outros estudantes.
export async function turmasDoEstudante(estudanteId) {
  const { rows } = await query(
    // A turma de quem foi REMOVIDO continua na lista, marcada. Quem saiu por conta
    // própria sabe que saiu; quem foi removido não saberia de nada — a turma
    // desapareceria sem explicação, que é o pior desfecho possível para quem ainda vai
    // perguntar ao professor o que houve.
    `SELECT t.id, t.nome, t.descricao, t.situacao AS situacao_turma, u.nome AS professor,
            te.situacao, te.solicitado_em, te.decidido_em, te.saiu_em,
            (te.removido_por IS NOT NULL) AS removido
       FROM turma_estudante te
       JOIN turma t ON t.id = te.turma_id
       JOIN usuario u ON u.id = t.professor_id
      WHERE te.estudante_id = $1
        AND (te.situacao <> 'SAIU' OR te.removido_por IS NOT NULL)
      ORDER BY (te.situacao = 'APROVADA') DESC, lower(t.nome)`,
    [estudanteId],
  );
  return {
    turmas: rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      professor: r.professor,
      turmaAtiva: r.situacao_turma === 'ATIVA',
      situacao: r.situacao,
      // A tela usa isto para dizer o que aconteceu, em vez de "você saiu".
      removido: r.removido === true,
      saiuEm: r.saiu_em,
      solicitadoEm: r.solicitado_em,
      decididoEm: r.decidido_em,
    })),
  };
}
