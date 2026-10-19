// Estado de carregamento padronizado (RNF06). `role="status"` faz leitores de tela
// anunciarem a espera sem roubar o foco de quem está navegando.
export function Carregando({ mensagem = 'Carregando…' }) {
  return (
    <p className="carregando" role="status">
      {mensagem}
    </p>
  );
}
