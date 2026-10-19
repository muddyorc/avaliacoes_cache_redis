// Guarda de rota do frontend (RF01).
//
// ATENÇÃO: isto é conveniência de navegação, NÃO é segurança. Qualquer pessoa pode
// chamar a API diretamente sem passar por aqui. Quem realmente protege os dados é o
// backend (middleware/autenticacao.js). Esta guarda só evita que o usuário veja uma
// tela vazia ou um erro feio ao abrir um endereço que não lhe pertence.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { caminhoInicial, useAuth } from './ContextoAuth.jsx';
import { Carregando } from '../componentes/Carregando.jsx';

export function RotaProtegida({ perfis }) {
  const { usuario, carregando } = useAuth();
  const local = useLocation();

  if (carregando) return <Carregando mensagem="Verificando sua sessão…" />;

  // Guarda o endereço pedido para voltar a ele depois do login.
  if (!usuario) return <Navigate to="/entrar" state={{ de: local.pathname }} replace />;

  if (perfis && !perfis.includes(usuario.perfil)) {
    return <Navigate to={caminhoInicial(usuario)} replace />;
  }

  return <Outlet />;
}

// Impede que quem já está autenticado volte para a tela de login.
export function RotaPublica() {
  const { usuario, carregando } = useAuth();

  if (carregando) return <Carregando mensagem="Verificando sua sessão…" />;
  if (usuario) return <Navigate to={caminhoInicial(usuario)} replace />;

  return <Outlet />;
}
