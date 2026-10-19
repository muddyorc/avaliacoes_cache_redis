// Controle de acesso da API (RNF16, RF01).
//
// Regra do projeto: a autorização acontece SEMPRE no backend. Esconder um botão no
// frontend não protege nada — qualquer pessoa pode chamar a rota diretamente. O perfil
// nunca é lido do corpo, do cabeçalho ou de qualquer dado enviado pelo cliente: é
// relido do banco a cada requisição, a partir do id assinado no JWT.
import { COOKIE_SESSAO, buscarUsuarioAtivo, verificarTokenSessao } from '../modules/auth/auth.service.js';
import { ErroApp } from './erros.js';

const NAO_AUTENTICADO = 'É necessário entrar no sistema para acessar este recurso.';

// Exige sessão válida. Preenche `req.usuario` com os dados vindos do banco.
export async function autenticar(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_SESSAO];
    if (!token) throw new ErroApp(401, NAO_AUTENTICADO);

    const conteudo = verificarTokenSessao(token);
    if (!conteudo) throw new ErroApp(401, 'Sua sessão expirou. Entre novamente.');

    // Releitura no banco: conta inativada ou removida perde o acesso imediatamente,
    // mesmo que o token ainda esteja dentro da validade.
    const usuario = await buscarUsuarioAtivo(Number(conteudo.sub));
    if (!usuario) throw new ErroApp(401, 'Sua sessão não é mais válida. Entre novamente.');

    req.usuario = usuario;
    next();
  } catch (erro) {
    next(erro);
  }
}

// Restringe a rota aos perfis indicados. Use sempre DEPOIS de `autenticar`.
export function autorizar(...perfis) {
  return function verificarPerfil(req, res, next) {
    if (!req.usuario) return next(new ErroApp(401, NAO_AUTENTICADO));
    if (!perfis.includes(req.usuario.perfil)) {
      return next(new ErroApp(403, 'Seu perfil não tem permissão para acessar este recurso.'));
    }
    next();
  };
}
