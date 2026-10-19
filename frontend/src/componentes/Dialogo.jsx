// Caixa de confirmação do sistema, no lugar do `window.confirm` do navegador.
//
// O `confirm` nativo tinha três problemas, e nenhum é estético: ele desenha a caixa do
// sistema operacional (fonte, cores e botões alheios ao resto da aplicação), só aceita
// texto corrido — nada de lista, destaque ou tabela — e corta o conteúdo com barra de
// rolagem quando passa de poucas linhas, que era o caso do aviso de monitoramento.
//
// `<dialog>` nativo, e não uma `<div>` com `position: fixed`: o elemento do HTML já traz
// de fábrica o que um modal precisa ter e quase nunca tem — foco preso dentro dele, Esc
// fechando, o resto da página marcado como inerte para leitor de tela, e a camada
// superior do navegador, que ignora `z-index` e `overflow` dos ancestrais.
import { useEffect, useRef } from 'react';

export function Dialogo({
  aberto,
  titulo,
  confirmar = 'Confirmar',
  cancelar = 'Cancelar',
  // Quando a caixa pede dados, quem a usa diz se o que foi preenchido basta. Confirmar
  // com campo vazio e descobrir o erro depois de a caixa fechar é pior que não poder
  // confirmar: a pessoa perde o que escreveu e não sabe o que faltou.
  podeConfirmar = true,
  aoConfirmar,
  aoCancelar,
  children,
}) {
  const caixa = useRef(null);

  useEffect(() => {
    const dialogo = caixa.current;
    if (!dialogo) return;
    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  // O Esc fecha o `<dialog>` por conta própria, por baixo do React. Barramos esse
  // fechamento e avisamos o pai: é ele quem controla o estado, e o efeito acima fecha a
  // caixa em seguida. Sem isso, o estado continuaria dizendo "aberto" e o botão pararia
  // de responder.
  //
  // Só o evento `cancel`, e não o `close`: `close` também dispara quando somos nós que
  // fechamos a caixa, e aí `aoCancelar` rodaria depois de uma confirmação bem-sucedida.
  const aoEscapar = (evento) => {
    evento.preventDefault();
    aoCancelar();
  };

  return (
    <dialog
      className="dialogo"
      ref={caixa}
      onCancel={aoEscapar}
      // Clique no fundo escuro fecha. O alvo do clique é o próprio `<dialog>` quando cai
      // fora da caixa, porque o conteúdo vive dentro de outro elemento.
      onClick={(e) => e.target === caixa.current && aoCancelar()}
      aria-labelledby="dialogo-titulo"
    >
      <div className="dialogo-corpo">
        <h2 id="dialogo-titulo">{titulo}</h2>
        <div className="dialogo-conteudo">{children}</div>
        <div className="dialogo-acoes">
          {/* Cancelar primeiro na ordem do DOM, e sem `autoFocus` em lugar nenhum: o
              `<dialog>` foca o primeiro elemento focável, que passa a ser o Cancelar.
              Quem abrir a caixa e apertar Enter sem ler não dispara a ação sem volta. */}
          <button className="botao botao-secundario" type="button" onClick={aoCancelar}>
            {cancelar}
          </button>
          {/* Fecha a caixa ANTES de executar a ação, de forma síncrona.
              Um `<dialog>` modal vive na camada superior do navegador, e enquanto ele
              está aberto um pedido de tela cheia no documento é recusado. Fechar aqui
              resolve sem perder o gesto: ainda estamos dentro do clique, que é o que o
              navegador exige para conceder. */}
          <button
            className="botao"
            type="button"
            disabled={!podeConfirmar}
            onClick={() => {
              caixa.current?.close();
              aoConfirmar();
            }}
          >
            {confirmar}
          </button>
        </div>
      </div>
    </dialog>
  );
}
