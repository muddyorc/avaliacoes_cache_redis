// RF01 — Autenticar Usuários. Regras de negócio da autenticação, sessão e
// recuperação de senha (UC01 e UC01 A2). Nenhuma rota é definida aqui.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, transacao } from '../../db/pool.js';
import { env, emProducao } from '../../config/env.js';
import { ErroApp } from '../../middleware/erros.js';
import { enviarEmail, montarEmailDeRedefinicao, smtpConfigurado } from '../../servicos/email.js';

const CUSTO_BCRYPT = 10;
export const COOKIE_SESSAO = 'sessao';

// Mensagem única para "e-mail não existe" e "senha errada": revelar qual dos dois falhou
// permitiria descobrir quais e-mails têm conta no sistema.
const CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos.';

// Hash descartável, de senha aleatória, comparado quando o e-mail não existe. Sem ele o
// login responderia visivelmente mais rápido para e-mails inexistentes (porque pularia o
// bcrypt), e esse tempo denunciaria quais contas existem.
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), CUSTO_BCRYPT);

// Campos que a API pode devolver sobre um usuário. `senha_hash` JAMAIS entra aqui.
function usuarioPublico(linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    perfil: linha.perfil,
    situacao: linha.situacao,
  };
}

// ---------------------------------------------------------------- registro de acesso

// UC01, pós-condição: "o sistema registra o acesso realizado". Guardamos também as
// tentativas que falharam, para auditoria. Registros de acesso nunca são apagados (P-02).
// Uma falha ao gravar o histórico não pode impedir o login: apenas registra no log.
export async function registrarAcesso({ usuarioId = null, emailInformado, sucesso, motivo = null, ip, userAgent }) {
  try {
    await query(
      `INSERT INTO registro_acesso (usuario_id, email_informado, sucesso, motivo, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, emailInformado ?? null, sucesso, motivo, ip ?? null, userAgent?.slice(0, 500) ?? null],
    );
  } catch (erro) {
    console.error('[auth] falha ao gravar registro_acesso:', erro.message);
  }
}

// ---------------------------------------------------------------- sessão (JWT + cookie)

export function gerarTokenSessao(usuario) {
  // O perfil vai no token apenas como informação; a autorização SEMPRE relê o perfil
  // do banco (middleware/autenticacao.js), para que inativação e troca de perfil
  // tenham efeito imediato, sem esperar o token expirar.
  return jwt.sign({ perfil: usuario.perfil }, env.jwtSecret, {
    subject: String(usuario.id),
    expiresIn: env.sessaoSegundos,
  });
}

export function opcoesDoCookie() {
  return {
    httpOnly: true, // JavaScript da página não lê o cookie: sem roubo de sessão por XSS
    sameSite: 'strict', // o cookie não acompanha requisições vindas de outros sites (CSRF)
    secure: emProducao, // em dev o front roda em http://localhost; em produção, só HTTPS
    path: '/',
    maxAge: env.sessaoSegundos * 1000,
  };
}

export function verificarTokenSessao(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- login

export async function autenticar({ email, senha, ip, userAgent }) {
  const { rows } = await query(
    'SELECT id, nome, email, senha_hash, perfil, situacao FROM usuario WHERE lower(email) = $1',
    [email],
  );
  const usuario = rows[0];

  // Mesmo sem usuário, executa um bcrypt para igualar o tempo de resposta.
  const senhaConfere = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FALSO);

  if (!usuario || !senhaConfere) {
    await registrarAcesso({
      usuarioId: usuario?.id ?? null,
      emailInformado: email,
      sucesso: false,
      motivo: 'CREDENCIAIS_INVALIDAS',
      ip,
      userAgent,
    });
    throw new ErroApp(401, CREDENCIAIS_INVALIDAS);
  }

  // Conta inativa só é revelada DEPOIS da senha correta: quem chega aqui já provou ser o
  // dono da conta, então a mensagem específica não vaza a existência do e-mail a terceiros.
  if (usuario.situacao !== 'ATIVO') {
    await registrarAcesso({
      usuarioId: usuario.id,
      emailInformado: email,
      sucesso: false,
      motivo: 'CONTA_INATIVA',
      ip,
      userAgent,
    });
    throw new ErroApp(403, 'Esta conta está inativa. Procure o administrador do sistema.');
  }

  await registrarAcesso({ usuarioId: usuario.id, emailInformado: email, sucesso: true, ip, userAgent });
  return usuarioPublico(usuario);
}

// Usado pelo middleware de autenticação a cada requisição protegida.
// Devolve null se o usuário sumiu ou foi inativado desde a emissão do token.
export async function buscarUsuarioAtivo(id) {
  const { rows } = await query(
    "SELECT id, nome, email, perfil, situacao FROM usuario WHERE id = $1 AND situacao = 'ATIVO'",
    [id],
  );
  return rows[0] ? usuarioPublico(rows[0]) : null;
}

// ---------------------------------------------------------------- recuperação de senha

function hashDoToken(token) {
  // O token é aleatório de 256 bits, então SHA-256 basta: não há espaço de busca para
  // força bruta e não é uma senha escolhida por pessoa. O banco guarda somente o hash,
  // de modo que vazar a tabela não permite redefinir a senha de ninguém.
  return crypto.createHash('sha256').update(token).digest('hex');
}

// UC01 A2 / P-11. Devolve sempre o mesmo resultado para o cliente, exista o e-mail ou não.
// `linkDesenvolvimento` só é preenchido fora de produção e SEM SMTP, e é usado apenas
// pelos testes automatizados — a rota nunca o envia na resposta HTTP.
export async function solicitarRedefinicao({ email, ip }) {
  const { rows } = await query(
    'SELECT id, nome, email, situacao FROM usuario WHERE lower(email) = $1',
    [email],
  );
  const usuario = rows[0];

  // Conta inexistente ou inativa: nada é gerado, mas a resposta ao cliente é idêntica.
  if (!usuario || usuario.situacao !== 'ATIVO') {
    console.log(`[auth] pedido de redefinição para e-mail sem conta ativa (${email}) — nada enviado. IP: ${ip ?? '-'}`);
    return { linkDesenvolvimento: null };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiraEm = new Date(Date.now() + env.redefinicaoSegundos * 1000);

  await transacao(async (client) => {
    // Pedir um novo link invalida os anteriores: só o último vale.
    await client.query(
      'UPDATE token_redefinicao_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL',
      [usuario.id],
    );
    await client.query(
      'INSERT INTO token_redefinicao_senha (usuario_id, token_hash, expira_em) VALUES ($1, $2, $3)',
      [usuario.id, hashDoToken(token), expiraEm],
    );
  });

  const link = `${env.frontendUrl}/redefinir-senha?token=${token}`;
  const { assunto, texto } = montarEmailDeRedefinicao({
    nome: usuario.nome,
    link,
    validadeMinutos: Math.round(env.redefinicaoSegundos / 60),
  });
  await enviarEmail({ para: usuario.email, assunto, texto });

  return { linkDesenvolvimento: !emProducao && !smtpConfigurado ? link : null };
}

async function buscarTokenUtilizavel(client, token) {
  const { rows } = await client.query(
    `SELECT t.id, t.usuario_id, t.expira_em, t.usado_em, u.situacao
       FROM token_redefinicao_senha t
       JOIN usuario u ON u.id = t.usuario_id
      WHERE t.token_hash = $1
      FOR UPDATE OF t`,
    [hashDoToken(token)],
  );
  const registro = rows[0];

  // Token inexistente, já usado e token expirado devolvem a MESMA mensagem: não há
  // motivo para informar a quem tem um link inválido em qual dos casos ele se encaixa.
  if (!registro || registro.usado_em || registro.expira_em <= new Date() || registro.situacao !== 'ATIVO') {
    throw new ErroApp(400, 'Este link de redefinição é inválido ou expirou. Solicite um novo.');
  }
  return registro;
}

export async function verificarTokenDeRedefinicao(token) {
  return transacao(async (client) => {
    await buscarTokenUtilizavel(client, token);
    return { valido: true };
  });
}

export async function redefinirSenha({ token, senha }) {
  return transacao(async (client) => {
    const registro = await buscarTokenUtilizavel(client, token);
    const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

    await client.query('UPDATE usuario SET senha_hash = $1, atualizado_em = now() WHERE id = $2', [
      senhaHash,
      registro.usuario_id,
    ]);
    // Uso único: marca este token e derruba qualquer outro ainda pendente do usuário.
    await client.query(
      'UPDATE token_redefinicao_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL',
      [registro.usuario_id],
    );
    return { redefinida: true };
  });
}
