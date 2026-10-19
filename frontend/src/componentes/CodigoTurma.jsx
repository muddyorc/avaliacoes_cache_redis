// Código de acesso da turma com botão de copiar (UC06: "o código de acesso permanece
// disponível para compartilhamento pelo professor").
import { useState } from 'react';

export function CodigoTurma({ codigo, compacto = false }) {
  const [copiado, setCopiado] = useState('');

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado('Copiado!');
    } catch {
      // A área de transferência exige HTTPS ou localhost; fora disso o código fica
      // visível na tela para ser copiado à mão.
      setCopiado('Selecione e copie o código.');
    }
    setTimeout(() => setCopiado(''), 2500);
  }

  return (
    <div className={`codigo-turma${compacto ? ' codigo-turma-compacto' : ''}`}>
      <span className="texto-suave">Código de acesso</span>
      <code className="codigo-turma-valor" aria-label={`Código de acesso ${codigo.split('').join(' ')}`}>
        {codigo}
      </code>
      <button className="botao botao-secundario botao-pequeno" type="button" onClick={copiar}>
        Copiar
      </button>
      <span className="texto-suave" role="status">
        {copiado}
      </span>
    </div>
  );
}
