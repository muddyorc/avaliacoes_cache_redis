// O logo nas telas de fora da sessão: login, criar conta e recuperação de senha.
//
// Essas telas não usam o Layout — não há barra superior antes de entrar —, então a marca
// precisa aparecer por conta própria. É a primeira coisa que alguém vê do sistema.
//
// Mesma técnica da barra superior: o desenho entra como máscara, e quem dá a cor é o CSS.
// O arquivo é azul escuro e sumiria sobre a superfície do modo noturno.
export function MarcaPublica() {
  return (
    <div className="marca-publica">
      <span className="marca-logo" role="img" aria-label="Avaliune" />
    </div>
  );
}
