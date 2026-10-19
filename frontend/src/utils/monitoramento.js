// RF10 / UC10 — a parte do monitoramento que vive no navegador.
//
// O que é possível observar aqui é **só** o que o navegador expõe (RNF12): quando a
// janela perde o foco, quando a aba deixa de estar visível e quais teclas foram
// pressionadas dentro da página. Nada além disso — o sistema não vê a tela do estudante,
// não sabe que programa está aberto e não enxerga outro dispositivo.
//
// O papel deste arquivo é observar e relatar. Quem conta, decide e encerra é o servidor:
// uma página adulterada pode deixar de relatar, mas não consegue se declarar liberada.
//
// Os eventos são acumulados e enviados em lote. A janela perde e recupera o foco várias
// vezes em poucos segundos — uma requisição por evento transformaria o monitoramento no
// maior gerador de tráfego da prova.

// Atalhos observados. A lista é curta de propósito: são as combinações ligadas a copiar,
// colar, imprimir e abrir outra janela. Teclas do sistema operacional (Alt+Tab, por
// exemplo) não chegam à página e por isso não aparecem aqui.
const ATALHOS = [
  { ctrl: true, tecla: 'c', nome: 'Ctrl+C' },
  { ctrl: true, tecla: 'v', nome: 'Ctrl+V' },
  { ctrl: true, tecla: 'x', nome: 'Ctrl+X' },
  { ctrl: true, tecla: 'p', nome: 'Ctrl+P' },
  { ctrl: true, tecla: 't', nome: 'Ctrl+T' },
  { ctrl: true, tecla: 'n', nome: 'Ctrl+N' },
  { ctrl: true, shift: true, tecla: 'i', nome: 'Ctrl+Shift+I' },
  { ctrl: true, shift: true, tecla: 'c', nome: 'Ctrl+Shift+C' },
  { ctrl: true, shift: true, tecla: 'j', nome: 'Ctrl+Shift+J' },
  { tecla: 'f12', nome: 'F12' },
  { tecla: 'printscreen', nome: 'PrintScreen' },
];

// Exportada para teste unitário: é a regra que decide se uma tecla pressionada vira
// ocorrência, e ela precisa valer para Ctrl e para a tecla Command do macOS, sem confundir
// combinações parecidas (Ctrl+C e Ctrl+Shift+C são eventos diferentes).
export function atalhoMonitorado(evento) {
  const tecla = String(evento.key ?? '').toLowerCase();
  return ATALHOS.find(
    (a) =>
      a.tecla === tecla &&
      Boolean(a.ctrl) === (evento.ctrlKey || evento.metaKey) &&
      Boolean(a.shift) === evento.shiftKey,
  );
}

// Recursos de que o monitoramento depende. Quando algum falta, o UC10 A5 manda registrar
// a indisponibilidade em vez de seguir como se o recurso existisse.
function recursosIndisponiveis() {
  const faltando = [];
  if (typeof document.visibilityState !== 'string') faltando.push('visibilitychange');
  if (typeof window.addEventListener !== 'function') faltando.push('eventos de janela');
  return faltando;
}

/**
 * Liga o monitoramento da prova.
 *
 * @param {object} opcoes
 * @param {(eventos: Array) => Promise<object>} opcoes.enviar  envia o lote ao servidor
 * @param {(estado: object) => void} opcoes.aoBloquear  chamado quando o servidor encerra
 * @param {number} [opcoes.intervalo]  espera antes de enviar o lote acumulado
 * @returns {() => void}  função que desliga tudo
 */
export function iniciarMonitoramento({ enviar, aoBloquear, intervalo = 4000 }) {
  let fila = [];
  let temporizador = null;
  let desligado = false;

  function agendarEnvio() {
    if (temporizador || desligado) return;
    temporizador = setTimeout(despachar, intervalo);
  }

  async function despachar() {
    temporizador = null;
    if (desligado || fila.length === 0) return;
    // Esvazia a fila antes de enviar: o que acontecer durante a requisição entra no
    // próximo lote, em vez de se perder ou ser enviado duas vezes.
    const lote = fila.slice(0, 50);
    fila = fila.slice(50);
    try {
      const estado = await enviar(lote);
      if (estado?.bloqueada) {
        desligar();
        aoBloquear?.(estado);
        return;
      }
    } catch {
      // Falha de rede não pode interromper a prova nem travar a tela: o lote volta para a
      // fila e segue na próxima tentativa. Se a conexão não voltar, esses eventos se
      // perdem — e é melhor assim do que impedir alguém de responder.
      fila = [...lote, ...fila].slice(-200);
    }
    if (fila.length > 0) agendarEnvio();
  }

  function registrar(tipo, detalhe) {
    if (desligado) return;
    fila.push(detalhe ? { tipo, detalhe } : { tipo });
    agendarEnvio();
  }

  // ----------------------------------------------------------------- escutas

  const aoPerderFoco = () => registrar('PERDA_FOCO');
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'hidden') registrar('TROCA_ABA');
  };
  const aoTeclar = (evento) => {
    const atalho = atalhoMonitorado(evento);
    if (atalho) registrar('ATALHO', atalho.nome);
  };

  // Sair da tela cheia (migração 018). Em tela cheia a barra de abas some, então deixar
  // de estar nela devolve ao estudante o caminho mais curto para outra aba — e isso é
  // informação para o professor. Não conta para o limite: o Esc é fácil de esbarrar, e
  // há motivos legítimos para sair, como ajustar o zoom ou usar um leitor de tela.
  //
  // O evento é o mesmo para Esc, F11 e o botão do navegador: o que se observa é o
  // ESTADO mudando, não a tecla — e é por isso que ele não é um 'ATALHO'.
  let estavaEmTelaCheia = Boolean(document.fullscreenElement);
  const aoMudarTelaCheia = () => {
    const agora = Boolean(document.fullscreenElement);
    if (estavaEmTelaCheia && !agora) registrar('SAIU_TELA_CHEIA');
    estavaEmTelaCheia = agora;
  };

  const faltando = recursosIndisponiveis();
  for (const recurso of faltando) registrar('RECURSO_INDISPONIVEL', recurso);

  window.addEventListener('blur', aoPerderFoco);
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  window.addEventListener('keydown', aoTeclar);
  document.addEventListener('fullscreenchange', aoMudarTelaCheia);

  function desligar() {
    if (desligado) return;
    desligado = true;
    clearTimeout(temporizador);
    window.removeEventListener('blur', aoPerderFoco);
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    window.removeEventListener('keydown', aoTeclar);
    document.removeEventListener('fullscreenchange', aoMudarTelaCheia);
  }

  // Ao sair da prova, o que estiver na fila é enviado — sem esperar o intervalo.
  return function encerrar() {
    const pendentes = fila.slice(0, 50);
    desligar();
    if (pendentes.length > 0) enviar(pendentes).catch(() => {});
  };
}
