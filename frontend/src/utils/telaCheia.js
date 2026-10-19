// A prova ocupando a tela inteira.
//
// Em tela cheia a barra de abas do navegador some, e trocar de aba — que é o que o
// monitoramento mais observa — passa a exigir um passo a mais. NÃO é segurança: não
// impede segundo monitor, celular ao lado nem alt-tab. É foco, e o estudante sai quando
// quiser; sair fica registrado (migração 018).
//
// O NAVEGADOR SÓ CONCEDE A PARTIR DE UM GESTO. É por isso que esta função precisa ser
// chamada de dentro de um `onClick`, e nunca ao carregar a página ou depois de esperar
// uma resposta do servidor — nesses casos o pedido é recusado sem aviso.
//
// Como a aplicação é de página única, o documento sobrevive à navegação: pedir a tela
// cheia no clique de um link que leva à prova funciona, e a prova já abre nela.
export function pedirTelaCheia() {
  // A recusa é ignorada de propósito: nenhuma prova pode deixar de acontecer porque o
  // navegador não quis, ou porque a pessoa já está em tela cheia.
  document.documentElement.requestFullscreen?.().catch((erro) => {
    // A recusa nao interrompe nada, mas fica no console: sem isso, descobrir POR QUE a
    // tela cheia nao abriu exige adivinhacao. Os motivos reais sao poucos e concretos —
    // pedido fora de um gesto do usuario, ou uma caixa modal ainda aberta na camada
    // superior do navegador.
    console.warn('[tela cheia] o navegador recusou:', erro?.message ?? erro);
  });
}

// Sair, ao terminar. A tela cheia é da PROVA, não do site: deixar o resto da aplicação
// ocupando o monitor inteiro depois da entrega seria herdar um estado que ninguém pediu.
//
// Sair não precisa de gesto nenhum — é entrar que o navegador restringe.
export function sairDaTelaCheia() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
