// Estado vazio padrão: ícone, o que está vazio e o que fazer a respeito.
//
// Existe para que "não há nada aqui" nunca vire uma tela em branco — e para que todas
// as telas digam isso do mesmo jeito.
export function EstadoVazio({ Icone, titulo, children, acao }) {
  return (
    <div className="estado-vazio">
      {Icone && (
        <span className="estado-vazio-icone" aria-hidden="true">
          <Icone />
        </span>
      )}
      <h3>{titulo}</h3>
      {children && <p>{children}</p>}
      {acao}
    </div>
  );
}
