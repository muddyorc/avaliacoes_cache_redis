// Ícones de linha da navegação e dos cartões.
//
// São desenhados aqui, em SVG simples, em vez de virem de uma biblioteca: são poucos,
// herdam a cor do texto (`currentColor`) e assim funcionam nos dois temas sem ajuste.
// Todos são decorativos — quem dá o nome da ação é o texto ao lado ou o `aria-label`.
const comuns = {
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
  focusable: 'false',
};

export const IconeInicio = (p) => (
  <svg {...comuns} {...p}>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </svg>
);

export const IconeProva = (p) => (
  <svg {...comuns} {...p}>
    <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5M8.5 13.5l2 2 4-4" />
  </svg>
);

// Banco de questões: uma pilha de fichas. Com a lateral fechada só se vê o ícone, então
// ele não pode repetir o da avaliação — seriam dois itens iguais no trilho.
export const IconeBanco = (p) => (
  <svg {...comuns} {...p}>
    <path d="M4 7.5 12 4l8 3.5-8 3.5z" />
    <path d="M4 12l8 3.5 8-3.5M4 16.5 12 20l8-3.5" />
  </svg>
);

export const IconeTurma = (p) => (
  <svg {...comuns} {...p}>
    <path d="M12 4 3 8.5l9 4.5 9-4.5z" />
    <path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11" />
  </svg>
);

export const IconePessoa = (p) => (
  <svg {...comuns} {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c.6-3.6 3.7-5.6 7.5-5.6s6.9 2 7.5 5.6" />
  </svg>
);

// Usuários: duas pessoas. Mesma razão do ícone do banco — no trilho fechado, "Usuários"
// e "Meus dados" não podem ser o mesmo desenho.
export const IconePessoas = (p) => (
  <svg {...comuns} {...p}>
    <path d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11z" />
    <path d="M2.5 20v-1.2C2.5 16.1 5.4 14 9 14s6.5 2.1 6.5 4.8V20" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M17.5 14.3c2.3.5 4 2.3 4 4.5V20" />
  </svg>
);

export const IconeSair = (p) => (
  <svg {...comuns} {...p}>
    <path d="M14 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
    <path d="M10 12h10m0 0-3-3m3 3-3 3" />
  </svg>
);

// Três pontos: as ações do cartão, no canto do rodapé.
export const IconeTresPontos = (p) => (
  <svg {...comuns} {...p}>
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

// Sair da turma: a porta com a seta para fora, o mesmo desenho de "Sair" do sistema,
// mas aqui a ação é deixar a turma.
export const IconeSairTurma = (p) => (
  <svg {...comuns} {...p}>
    <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
    <path d="M17 8.5 20.5 12 17 15.5M20 12h-9" />
  </svg>
);

export const IconeMenu = (p) => (
  <svg {...comuns} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconeRelogio = (p) => (
  <svg {...comuns} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconeGrafico = (p) => (
  <svg {...comuns} {...p}>
    <path d="M4 20V5M4 20h16" />
    <path d="M8.5 20v-6M13 20V9.5M17.5 20v-3.5" />
  </svg>
);

// Campo de senha: o olho mostra o que foi digitado; o olho riscado esconde de volta.
// O risco atravessa o desenho inteiro, porque "escondido" precisa ser reconhecível de
// relance — um olho com a pálpebra meio fechada se confunde com o aberto em 20 px.
export const IconeOlho = (p) => (
  <svg {...comuns} {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconeOlhoRiscado = (p) => (
  <svg {...comuns} {...p}>
    <path d="M10.6 6.2A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.2 4.1M6.5 7.9A17.8 17.8 0 0 0 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.45 4.5-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
  </svg>
);

export const IconeMais = (p) => (
  <svg {...comuns} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// Duplicar: duas folhas, uma atrás da outra — é o desenho que todo mundo já associa a
// "cópia", e aqui ele divide o menu com arquivar e excluir, que têm a mesma história.
export const IconeDuplicar = (p) => (
  <svg {...comuns} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </svg>
);

export const IconeArquivar = (p) => (
  <svg {...comuns} {...p}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />
  </svg>
);

export const IconeExcluir = (p) => (
  <svg {...comuns} {...p}>
    <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7l.8 12a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12M10.5 11v5M13.5 11v5" />
  </svg>
);

export const IconeSino = (p) => (
  <svg {...comuns} {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 4.5-1.5 5.5-2 6.5h16c-.5-1-2-2-2-6.5" />
    <path d="M10.5 19a1.8 1.8 0 0 0 3 0" />
  </svg>
);

export const IconeSeta = (p) => (
  <svg {...comuns} {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
