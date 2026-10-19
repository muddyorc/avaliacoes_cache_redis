// O prazo da prova — DT06: quem decide o tempo é o servidor, nunca o relógio do
// navegador.
//
// Está fora do serviço pelo mesmo motivo das estatísticas: é aritmética de datas, sem
// banco e sem requisição, e é a regra que decide quando a prova de alguém acaba. Regra
// dessas merece teste próprio, direto, sem precisar subir a API.
const MINUTO = 60 * 1000;

// O prazo é o **menor** entre o tempo de prova e o fim do período da avaliação.
//
// Quem começa faltando dez minutos para o período fechar tem dez minutos, não a duração
// inteira: a avaliação encerra quando o professor disse que encerra. Na prática isso é o
// que impede iniciar a prova no último minuto para ganhar uma hora além do prazo.
export function prazoFinalDaProva(agora, duracaoMinutos, dataFim) {
  const inicio = new Date(agora);
  const fimDoPeriodo = new Date(dataFim);
  const porDuracao = new Date(inicio.getTime() + Number(duracaoMinutos) * MINUTO);
  return porDuracao < fimDoPeriodo ? porDuracao : fimDoPeriodo;
}

// Quanto falta, em milissegundos, sem devolver número negativo: prazo vencido é zero.
export function tempoRestante(agora, prazoFinal) {
  return Math.max(0, new Date(prazoFinal).getTime() - new Date(agora).getTime());
}

// A prova acabou? Comparação inclusiva: no instante exato do prazo, acabou.
export function prazoVencido(agora, prazoFinal) {
  return new Date(agora).getTime() >= new Date(prazoFinal).getTime();
}
