// RF01 — rotas de autenticação (UC01 e UC01 A2).
// Express 5 repassa erros de handlers `async` ao tratador de erros sem wrappers.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { autenticar as exigirSessao } from '../../middleware/autenticacao.js';
import { validar, z, esquemaEmail, esquemaSenha } from '../../utils/validacao.js';
import {
  COOKIE_SESSAO,
  autenticar,
  gerarTokenSessao,
  opcoesDoCookie,
  redefinirSenha,
  solicitarRedefinicao,
  verificarTokenDeRedefinicao,
} from './auth.service.js';

// Resposta idêntica para e-mail existente e inexistente: quem pede a recuperação não
// descobre se aquele e-mail tem conta no sistema (UC01 A2).
const RESPOSTA_RECUPERACAO =
  'Se houver uma conta ativa com este e-mail, enviaremos um link para redefinir a senha.';

function limitador({ limite, janelaMinutos, mensagem, ignorarSucesso = false }) {
  return rateLimit({
    windowMs: janelaMinutos * 60 * 1000,
    limit: limite,
    skipSuccessfulRequests: ignorarSucesso,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // `trust proxy` é 1 (proxy do Vite/Nginx à frente); a checagem permissiva do pacote
    // não se aplica a essa topologia fixa.
    validate: { trustProxy: false },
    handler: (req, res) => res.status(429).json({ erro: mensagem }),
  });
}

const esquemaLogin = z.object({
  email: esquemaEmail,
  // No login a senha não é validada por tamanho: senha curta é apenas senha errada.
  // Validar aqui devolveria um erro diferente e entregaria informação ao atacante.
  senha: z.string({ error: 'Informe a senha.' }).min(1, 'Informe a senha.').max(200, 'A senha é longa demais.'),
});

const esquemaRecuperacao = z.object({ email: esquemaEmail });
const esquemaToken = z.object({
  token: z.string({ error: 'Link inválido.' }).min(1, 'Link inválido.').max(500, 'Link inválido.'),
});
const esquemaRedefinicao = esquemaToken.extend({ senha: esquemaSenha });

// `opcoes.limites` permite que o teste de rate limiting monte um app com limites baixos
// sem depender de variáveis de ambiente.
export function criarRotasAuth(opcoes = {}) {
  const limites = { ...env.limites, ...opcoes.limites };
  const rotas = Router();

  const limitarLogin = limitador({
    limite: limites.loginMax,
    janelaMinutos: limites.janelaMinutos,
    mensagem: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.',
    // Só tentativas FALHAS contam: quem acerta a senha nunca é bloqueado.
    ignorarSucesso: true,
  });

  // Limite estreito: cada chamada bem-sucedida dispara um e-mail.
  const limitarRecuperacao = limitador({
    limite: limites.recuperacaoMax,
    janelaMinutos: limites.janelaMinutos,
    mensagem: 'Muitos pedidos de recuperação de senha. Aguarde alguns minutos e tente novamente.',
  });

  // Limite próprio para as duas chamadas que consomem o link. Compartilhar o contador com
  // o envio de e-mail travaria quem está apenas concluindo a própria redefinição.
  const limitarRedefinicao = limitador({
    limite: limites.redefinicaoMax,
    janelaMinutos: limites.janelaMinutos,
    mensagem: 'Muitas tentativas de redefinição. Aguarde alguns minutos e tente novamente.',
  });

  // POST /api/auth/login — cria a sessão. Responde com o usuário, nunca com o token.
  rotas.post('/login', limitarLogin, async (req, res) => {
    const { email, senha } = validar(esquemaLogin, req.body);
    const usuario = await autenticar({
      email,
      senha,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    // O JWT vai SOMENTE no cookie httpOnly: nunca no corpo, para que o frontend não
    // tenha como guardá-lo em localStorage (DT04).
    res.cookie(COOKIE_SESSAO, gerarTokenSessao(usuario), opcoesDoCookie());
    res.json({ usuario });
  });

  // POST /api/auth/logout — encerra a sessão. Idempotente: funciona mesmo sem sessão.
  rotas.post('/logout', (req, res) => {
    const { maxAge, ...opcoes } = opcoesDoCookie();
    res.clearCookie(COOKIE_SESSAO, opcoes);
    res.json({ mensagem: 'Sessão encerrada.' });
  });

  // GET /api/auth/eu — quem está autenticado. O frontend usa para restaurar a sessão
  // ao recarregar a página, já que não pode ler o cookie httpOnly.
  rotas.get('/eu', exigirSessao, (req, res) => {
    res.json({ usuario: req.usuario });
  });

  // POST /api/auth/recuperacao — dispara o e-mail com o link (UC01 A2).
  rotas.post('/recuperacao', limitarRecuperacao, async (req, res) => {
    const { email } = validar(esquemaRecuperacao, req.body);
    await solicitarRedefinicao({ email, ip: req.ip });
    // Nunca devolve o link nem indica se o e-mail existe.
    res.json({ mensagem: RESPOSTA_RECUPERACAO });
  });

  // POST /api/auth/redefinicao/verificar — a tela de redefinição checa o link antes
  // de pedir a nova senha, para não fazer a pessoa digitar à toa.
  rotas.post('/redefinicao/verificar', limitarRedefinicao, async (req, res) => {
    const { token } = validar(esquemaToken, req.body);
    res.json(await verificarTokenDeRedefinicao(token));
  });

  // POST /api/auth/redefinicao — grava a nova senha e consome o token.
  rotas.post('/redefinicao', limitarRedefinicao, async (req, res) => {
    const { token, senha } = validar(esquemaRedefinicao, req.body);
    await redefinirSenha({ token, senha });
    res.json({ mensagem: 'Senha redefinida. Entre com a nova senha.' });
  });

  return rotas;
}
