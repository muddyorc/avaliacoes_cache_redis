// Tema claro/escuro da aplicação (FRONTEND_DESIGN_SYSTEM.md).
//
// São três estados possíveis, e essa distinção importa: 'sistema' segue a preferência
// do computador do usuário e continua seguindo se ela mudar; 'claro' e 'escuro' são
// escolhas explícitas, que vencem o sistema e ficam guardadas no navegador.
//
// A escolha é gravada no atributo `data-tema` do <html>, que é o que `tokens.css` lê.
// Nenhum componente decide cor por conta própria.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CHAVE = 'avaliacoes:tema';
const ContextoTema = createContext(null);

function lerPreferencia() {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return salvo === 'claro' || salvo === 'escuro' ? salvo : 'sistema';
  } catch {
    // Navegador com armazenamento bloqueado: segue o sistema, sem quebrar a página.
    return 'sistema';
  }
}

export function ProvedorTema({ children }) {
  const [preferencia, definirPreferencia] = useState(lerPreferencia);
  // Só para a interface saber qual ícone mostrar quando a preferência é 'sistema'.
  const [sistemaEscuro, setSistemaEscuro] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  useEffect(() => {
    const consulta = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!consulta) return undefined;
    const aoMudar = (e) => setSistemaEscuro(e.matches);
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;
    if (preferencia === 'sistema') raiz.removeAttribute('data-tema');
    else raiz.setAttribute('data-tema', preferencia);
    try {
      if (preferencia === 'sistema') localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, preferencia);
    } catch {
      // Sem armazenamento a escolha vale só para esta aba — o tema em si funciona.
    }
  }, [preferencia]);

  const escuro = preferencia === 'escuro' || (preferencia === 'sistema' && sistemaEscuro);

  const valor = useMemo(
    () => ({
      preferencia,
      escuro,
      definirPreferencia,
      // Alternar a partir do que está na tela: quem está no claro vai para o escuro,
      // mesmo que a preferência atual seja 'sistema'.
      alternar: () => definirPreferencia(escuro ? 'claro' : 'escuro'),
    }),
    [preferencia, escuro],
  );

  return <ContextoTema.Provider value={valor}>{children}</ContextoTema.Provider>;
}

export function useTema() {
  const contexto = useContext(ContextoTema);
  if (!contexto) throw new Error('useTema precisa estar dentro de ProvedorTema.');
  return contexto;
}

// Lê um token de cor do CSS. Usado onde a cor precisa virar valor em JavaScript —
// hoje, só nos gráficos, que recebem a cor como propriedade.
export function corDoTema(token, alternativa = '') {
  if (typeof window === 'undefined') return alternativa;
  const valor = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return valor || alternativa;
}
