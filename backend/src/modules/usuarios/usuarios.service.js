// RF02 — Gerenciar Usuários e Perfis (UC02, UC03).
//
// Regras estruturais que atravessam todo o módulo:
//   - Sem exclusão física (P-02, Quadro 31): desativar é mudar `situacao` para INATIVO.
//   - Três perfis fixos (P-17); não existem perfis customizados.
//   - O autocadastro público cria estudante OU professor, nunca administrador. O P-18,
//     que reservava a criação de professores ao administrador, foi revertido a pedido do
//     orientador em 13/10/2026: cadastrar professor a professor não escala, e o perfil é
//     isolado por posse — cada um alcança só a própria turma e o próprio banco de questões.
//   - `senha_hash` jamais sai deste módulo.
import bcrypt from 'bcryptjs';
import { query, transacao } from '../../db/pool.js';
import { ErroApp } from '../../middleware/erros.js';

const CUSTO_BCRYPT = 10;
const PERFIS = ['ADMINISTRADOR', 'PROFESSOR', 'ESTUDANTE'];
const VIOLACAO_UNICIDADE = '23505';

// Colunas devolvidas pela API. A ausência de `senha_hash` aqui é intencional e é o que
// garante que nenhuma rota vaze o hash por descuido.
const CAMPOS = 'id, nome, email, perfil, situacao, criado_em, atualizado_em';

function traduzirConflitoDeEmail(erro) {
  if (erro.code === VIOLACAO_UNICIDADE && /usuario_email_unico/.test(erro.constraint ?? erro.message)) {
    return new ErroApp(409, 'Já existe uma conta com este e-mail.', {
      email: 'Já existe uma conta com este e-mail.',
    });
  }
  return erro;
}

// ---------------------------------------------------------------------------- consulta

// Listagem do administrador, com filtros e paginação (UC02).
export async function listar({ busca = '', perfil = null, situacao = null, pagina = 1, tamanho = 20 }) {
  const filtros = [];
  const valores = [];

  if (busca.trim()) {
    valores.push(`%${busca.trim().toLowerCase()}%`);
    filtros.push(`(lower(nome) LIKE $${valores.length} OR lower(email) LIKE $${valores.length})`);
  }
  if (perfil) {
    valores.push(perfil);
    filtros.push(`perfil = $${valores.length}`);
  }
  if (situacao) {
    valores.push(situacao);
    filtros.push(`situacao = $${valores.length}`);
  }

  const onde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const deslocamento = (pagina - 1) * tamanho;

  const { rows } = await query(
    `SELECT ${CAMPOS}, count(*) OVER () AS total
       FROM usuario ${onde}
      ORDER BY nome
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, tamanho, deslocamento],
  );

  // `count(*) OVER ()` traz o total na mesma consulta; sem linhas, o total é 0.
  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    usuarios: rows.map(({ total: _ignorado, ...usuario }) => usuario),
    total,
    pagina,
    tamanho,
    paginas: Math.max(1, Math.ceil(total / tamanho)),
  };
}

export async function buscarPorId(id) {
  const { rows } = await query(`SELECT ${CAMPOS} FROM usuario WHERE id = $1`, [id]);
  if (!rows[0]) throw new ErroApp(404, 'Usuário não encontrado.');
  return rows[0];
}

// --------------------------------------------- por que o sistema nunca fica sem admin
//
// Duas regras bastam para garantir que sempre exista ao menos um administrador ativo:
//   1. só um administrador ATIVO chega a estas rotas (middleware `autorizar`);
//   2. ninguém inativa nem rebaixa a si mesmo (checagens em `atualizar` e `alterarSituacao`).
//
// Logo, qualquer operação sobre OUTRA conta deixa pelo menos o autor da ação como
// administrador ativo. Não é preciso contar administradores no banco: uma contagem aqui
// nunca reprovaria nada e daria a falsa impressão de ser ela a proteção.

// ------------------------------------------------------------------------------ criação

// UC02 — o administrador cadastra professores, estudantes e outros administradores.
export async function criar({ nome, email, senha, perfil, situacao = 'ATIVO' }) {
  if (!PERFIS.includes(perfil)) throw new ErroApp(400, 'Perfil inválido.', { perfil: 'Perfil inválido.' });

  try {
    const { rows } = await query(
      `INSERT INTO usuario (nome, email, senha_hash, perfil, situacao)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${CAMPOS}`,
      [nome, email, await bcrypt.hash(senha, CUSTO_BCRYPT), perfil, situacao],
    );
    return rows[0];
  } catch (erro) {
    throw traduzirConflitoDeEmail(erro);
  }
}

// UC03 — autocadastro público.
//
// O perfil agora vem do cliente, mas por uma lista fechada de DOIS: estudante e
// professor. `ADMINISTRADOR` continua fora, e isso é o que separa esta função de um
// escalonamento de privilégio por corpo de requisição — quem mandar
// `"perfil": "ADMINISTRADOR"` recebe um estudante, como sempre recebeu.
//
// Conta nova nasce ATIVA: foi a decisão do autor em 13/10/2026, depois de verificado que
// um professor recém-criado não alcança dado de ninguém. Ele nasce com um mundo vazio —
// sem turma, sem questão, sem estudante — e só passa a ver alguém quando esse alguém
// digita o código da turma dele.
const PERFIS_PUBLICOS = ['ESTUDANTE', 'PROFESSOR'];

export async function autocadastrar({ nome, email, senha, perfil }) {
  const escolhido = PERFIS_PUBLICOS.includes(perfil) ? perfil : 'ESTUDANTE';
  return criar({ nome, email, senha, perfil: escolhido, situacao: 'ATIVO' });
}

// ------------------------------------------------------------------------------ edição

// UC02 — o administrador edita nome, e-mail e perfil de qualquer conta.
export async function atualizar(id, { nome, email, perfil }, autor) {
  return transacao(async (client) => {
    const { rows } = await client.query('SELECT id, perfil FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    const atual = rows[0];
    if (!atual) throw new ErroApp(404, 'Usuário não encontrado.');

    const mudaPerfil = perfil !== undefined && perfil !== atual.perfil;

    if (mudaPerfil && id === autor.id) {
      // Trocar o próprio perfil é como puxar o tapete: o administrador perderia o acesso
      // à tela onde está, sem conseguir voltar atrás — e o sistema poderia acabar sem
      // nenhum administrador ativo.
      throw new ErroApp(409, 'Você não pode alterar o seu próprio perfil.');
    }

    try {
      const { rows: atualizados } = await client.query(
        `UPDATE usuario
            SET nome = COALESCE($2, nome),
                email = COALESCE($3, email),
                perfil = COALESCE($4, perfil),
                atualizado_em = now()
          WHERE id = $1
      RETURNING ${CAMPOS}`,
        [id, nome ?? null, email ?? null, perfil ?? null],
      );
      return atualizados[0];
    } catch (erro) {
      throw traduzirConflitoDeEmail(erro);
    }
  });
}

// UC02 — ativar e inativar. É a "exclusão" prevista pelo projeto: o registro permanece
// no banco, com todo o histórico ligado a ele (P-02).
export async function alterarSituacao(id, situacao, autor) {
  if (!['ATIVO', 'INATIVO'].includes(situacao)) {
    throw new ErroApp(400, 'Situação inválida.', { situacao: 'Situação inválida.' });
  }

  return transacao(async (client) => {
    const { rows } = await client.query('SELECT id FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new ErroApp(404, 'Usuário não encontrado.');

    if (situacao === 'INATIVO' && id === autor.id) {
      // Inativar a si mesmo derrubaria a própria sessão na requisição seguinte e poderia
      // deixar o sistema sem nenhum administrador ativo.
      throw new ErroApp(409, 'Você não pode inativar a sua própria conta.');
    }

    const { rows: atualizados } = await client.query(
      `UPDATE usuario SET situacao = $2, atualizado_em = now() WHERE id = $1 RETURNING ${CAMPOS}`,
      [id, situacao],
    );
    return atualizados[0];
  });
}

// ------------------------------------------------------------------------- próprios dados

// UC03 — qualquer usuário autenticado edita os próprios dados. O perfil e a situação
// ficam de fora de propósito: mudá-los é atribuição do administrador (P-17).
export async function atualizarPropriosDados(id, { nome, email }) {
  try {
    const { rows } = await query(
      `UPDATE usuario
          SET nome = COALESCE($2, nome), email = COALESCE($3, email), atualizado_em = now()
        WHERE id = $1
    RETURNING ${CAMPOS}`,
      [id, nome ?? null, email ?? null],
    );
    if (!rows[0]) throw new ErroApp(404, 'Usuário não encontrado.');
    return rows[0];
  } catch (erro) {
    throw traduzirConflitoDeEmail(erro);
  }
}

// Troca da própria senha. Exige a senha atual: sem isso, uma sessão esquecida aberta em
// um computador compartilhado permitiria tomar a conta.
export async function alterarPropriaSenha(id, { senhaAtual, novaSenha }) {
  return transacao(async (client) => {
    const { rows } = await client.query('SELECT senha_hash FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new ErroApp(404, 'Usuário não encontrado.');

    if (!(await bcrypt.compare(senhaAtual, rows[0].senha_hash))) {
      throw new ErroApp(400, 'A senha atual está incorreta.', { senhaAtual: 'A senha atual está incorreta.' });
    }

    await client.query('UPDATE usuario SET senha_hash = $2, atualizado_em = now() WHERE id = $1', [
      id,
      await bcrypt.hash(novaSenha, CUSTO_BCRYPT),
    ]);
    // Quem acabou de trocar a senha não deve ter links de redefinição pendentes válidos.
    await client.query(
      'UPDATE token_redefinicao_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL',
      [id],
    );
    return { alterada: true };
  });
}

export { PERFIS };
