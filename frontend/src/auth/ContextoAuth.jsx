// Estado de autenticação compartilhado pela aplicação (RF01).
//
// O JWT fica em um cookie httpOnly: o JavaScript desta página NÃO consegue lê-lo, e é
// exatamente esse o ponto (DT04). Por isso o frontend não "guarda" a sessão em lugar
// nenhum — nem em localStorage, nem em sessionStorage. Ao carregar, ele pergunta ao
// servidor quem está autenticado (GET /api/auth/eu) e confia apenas nessa resposta.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const ContextoAuth = createContext(null);

export function ProvedorAuth({ children }) {
  const [usuario, setUsuario] = useState(null);
  // `carregando` cobre a primeira consulta: sem ele a aplicação piscaria a tela de
  // login antes de descobrir que a sessão ainda é válida.
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    api('/auth/eu')
      .then((dados) => ativo && setUsuario(dados.usuario))
      .catch(() => ativo && setUsuario(null)) // 401 é o caso normal de quem não entrou
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, []);

  const entrar = useCallback(async (email, senha) => {
    const dados = await api('/auth/login', { metodo: 'POST', corpo: { email, senha } });
    setUsuario(dados.usuario);
    return dados.usuario;
  }, []);

  // Relê a sessão no servidor. Usado quando o próprio usuário edita os seus dados: o
  // nome aparece no cabeçalho e precisa refletir a alteração sem recarregar a página.
  const recarregarUsuario = useCallback(async () => {
    try {
      const dados = await api('/auth/eu');
      setUsuario(dados.usuario);
      return dados.usuario;
    } catch {
      setUsuario(null);
      return null;
    }
  }, []);

  const sair = useCallback(async () => {
    try {
      await api('/auth/logout', { metodo: 'POST' });
    } finally {
      // Mesmo que a chamada falhe (rede fora), o estado local é limpo: quem clicou em
      // "Sair" não pode continuar vendo a interface autenticada.
      setUsuario(null);
    }
  }, []);

  const valor = useMemo(
    () => ({ usuario, carregando, entrar, sair, recarregarUsuario }),
    [usuario, carregando, entrar, sair, recarregarUsuario],
  );

  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}

export function useAuth() {
  const contexto = useContext(ContextoAuth);
  if (!contexto) throw new Error('useAuth precisa estar dentro de <ProvedorAuth>.');
  return contexto;
}

// Destino inicial de cada perfil depois do login (UC01: "redireciona conforme o perfil").
export const CAMINHO_POR_PERFIL = {
  ADMINISTRADOR: '/administrador',
  PROFESSOR: '/professor',
  ESTUDANTE: '/estudante',
};

export function caminhoInicial(usuario) {
  return CAMINHO_POR_PERFIL[usuario?.perfil] || '/';
}
