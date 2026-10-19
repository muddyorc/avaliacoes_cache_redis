// Etapa 1 — placeholder das áreas por perfil.
//
// Escopo deliberadamente mínimo: estas rotas existem para PROVAR que a autorização
// acontece no backend (RNF16) e para dar destino ao redirecionamento pós-login do
// RF01. Elas não implementam RF02 e seguintes — não listam, criam nem alteram nada.
// Cada etapa futura substitui a rota correspondente pelo conteúdo real.
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';

export const rotasPainel = Router();

// Toda rota deste módulo exige sessão válida.
rotasPainel.use(autenticar);

function resumo(req, res) {
  res.json({
    perfil: req.usuario.perfil,
    nome: req.usuario.nome,
    mensagem: 'Área disponível. As funcionalidades deste perfil chegam nas próximas etapas.',
  });
}

rotasPainel.get('/administrador', autorizar('ADMINISTRADOR'), resumo);
rotasPainel.get('/professor', autorizar('PROFESSOR'), resumo);
rotasPainel.get('/estudante', autorizar('ESTUDANTE'), resumo);
