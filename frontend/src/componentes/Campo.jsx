// Campo de formulário com rótulo e mensagem de erro (RNF01, RNF02, RNF06).
//
// `aria-invalid` e `aria-describedby` ligam o input à mensagem de erro, para que o erro
// seja anunciado por leitores de tela e não apenas visto.
//
// `multilinha` troca o <input> por <textarea> (enunciados, respostas esperadas).
//
// **Senha:** todo campo `type="password"` ganha, sozinho, o botão de mostrar o que foi
// digitado. Fica aqui, e não em cada tela, porque são nove campos de senha no sistema —
// login, cadastro, redefinição, troca da própria senha e criação de usuário pelo
// administrador — e um deles ficaria para trás na primeira distração.
import { useState } from 'react';
import { IconeOlho, IconeOlhoRiscado } from './Icones.jsx';

export function Campo({ id, rotulo, erro, dica, multilinha = false, ...props }) {
  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;
  const descricao = [erro ? idErro : null, dica ? idDica : null].filter(Boolean).join(' ');
  const Controle = multilinha ? 'textarea' : 'input';

  const ehSenha = props.type === 'password';
  const [visivel, setVisivel] = useState(false);

  const controle = (
    <Controle
      id={id}
      aria-invalid={erro ? 'true' : undefined}
      aria-describedby={descricao || undefined}
      {...props}
      // A troca é só de apresentação: o `name` e o `autoComplete` continuam os mesmos,
      // então o gerenciador de senhas do navegador segue entendendo o campo.
      type={ehSenha && visivel ? 'text' : props.type}
    />
  );

  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {ehSenha ? (
        <div className="campo-com-acao">
          {controle}
          <button
            type="button"
            className="campo-acao"
            // O botão não entra na ordem de tabulação: quem navega por teclado quer ir do
            // campo direto para "Entrar", e não esbarrar num controle opcional no caminho.
            // Continua alcançável por leitor de tela e por clique.
            tabIndex={-1}
            aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visivel}
            onClick={() => setVisivel((v) => !v)}
          >
            {visivel ? <IconeOlhoRiscado className="icone" /> : <IconeOlho className="icone" />}
          </button>
        </div>
      ) : (
        controle
      )}
      {dica && (
        <p className="campo-dica" id={idDica}>
          {dica}
        </p>
      )}
      {erro && (
        <p className="campo-erro" id={idErro}>
          {erro}
        </p>
      )}
    </div>
  );
}
