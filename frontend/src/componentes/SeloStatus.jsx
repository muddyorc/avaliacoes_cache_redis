// Situação da avaliação com rótulo em português e cor própria.
const ROTULO = {
  RASCUNHO: 'Rascunho',
  PUBLICADA: 'Publicada',
  ARQUIVADA: 'Arquivada',
};

export function SeloStatus({ status }) {
  return <span className={`selo selo-status-${status.toLowerCase()}`}>{ROTULO[status] ?? status}</span>;
}
