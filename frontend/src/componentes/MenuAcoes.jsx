// Menu de ações de um cartão: o botão de três pontos e a lista que ele abre.
//
// Existe como componente próprio porque o comportamento esperado de um menu — fechar ao
// clicar fora, fechar com Esc, dizer ao leitor de tela que abre um menu — não pode ser
// reescrito a cada tela que precisar de um.
//
// As ações ficam **fora** do link do cartão: um botão dentro de um link seria HTML
// inválido e disputaria o clique com a navegação.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconeTresPontos } from './Icones.jsx';

export function MenuAcoes({ rotulo = 'Mais ações', children }) {
  const [aberto, setAberto] = useState(false);
  const [acima, setAcima] = useState(false);
  const caixa = useRef(null);

  // Cartão no pé da janela: aberto para baixo, o menu ficaria fora da tela. Antes de
  // pintar, olhamos o espaço que sobra e viramos a abertura para cima se preciso.
  useLayoutEffect(() => {
    if (!aberto) return;
    const botao = caixa.current?.getBoundingClientRect();
    const menu = caixa.current?.querySelector('.menu-flutuante')?.getBoundingClientRect();
    if (!botao || !menu) return;
    setAcima(botao.bottom + menu.height + 16 > window.innerHeight && botao.top > menu.height);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (e) => {
      if (!caixa.current?.contains(e.target)) setAberto(false);
    };
    const aoTeclar = (e) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    <div className="menu-acoes" ref={caixa}>
      <button
        type="button"
        className="botao-icone"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotulo}
        title={rotulo}
      >
        <IconeTresPontos />
      </button>

      {/* Escolher uma ação fecha o menu: quem clicou já disse o que queria. */}
      {aberto && (
        <div
          className={`menu-flutuante menu-flutuante-fim${acima ? ' menu-flutuante-acima' : ''}`}
          role="menu"
          onClick={() => setAberto(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
