// Botão de alternar entre modo claro e escuro.
//
// O estado não é indicado só pelo ícone: o `aria-label` e o `title` dizem em palavras
// para onde a ação leva, e o botão anuncia o estado atual por `aria-pressed`.
import { useTema } from '../tema/ContextoTema.jsx';

function IconeSol() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}

function IconeLua() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function AlternarTema() {
  const { escuro, alternar } = useTema();
  const rotulo = escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro';

  return (
    <button type="button" className="botao-icone" onClick={alternar} title={rotulo} aria-label={rotulo} aria-pressed={escuro}>
      {escuro ? <IconeSol /> : <IconeLua />}
    </button>
  );
}
