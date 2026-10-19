// Conversões de data e hora entre a API e a interface.
//
// A API trabalha em ISO-8601 UTC (PROJECT_CONTEXT §3.1). O campo <input type="datetime-local">
// trabalha no horário LOCAL do navegador, sem fuso. A exibição é sempre em America/Sao_Paulo.

const FUSO = 'America/Sao_Paulo';

// ISO (UTC) → "AAAA-MM-DDTHH:mm" no horário local, para preencher o datetime-local.
export function paraCampoLocal(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// "AAAA-MM-DDTHH:mm" (horário local) → ISO UTC para enviar à API. Vazio vira ''.
export function deCampoLocal(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '' : data.toISOString();
}

export function formatarDataHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Formato de cronômetro, sempre em minutos: 60:00, 90:00, 45:00 — decisão do autor em
// 16/10/2026. A duração de uma prova é tempo que vai ser CONTADO, e o estudante vai ver
// exatamente esse relógio descer na tela; dizer "1 hora" aqui e mostrar números lá obriga
// a converter de cabeça. Sem transbordar para horas: "90:00" se lê direto, "1:30:00"
// pede uma conta para saber se cabe no intervalo entre duas aulas.
export function formatarDuracao(minutos) {
  return `${String(Math.max(0, Math.trunc(minutos))).padStart(2, '0')}:00`;
}

// O prazo que vale PARA ESTE ESTUDANTE.
//
// Com a prova em andamento é o prazo da tentativa dele, e não o fim do período da
// avaliação: quem começou uma prova de 60 minutos numa janela de duas semanas tem uma
// hora, não duas semanas. É a mesma regra do servidor (DT06) — o prazo real é o menor
// entre o tempo da prova e o término do período —, agora também do lado da tela.
//
// Ficou evidente com a devolução de prova (migração 016): o estudante que recebe trinta
// minutos aparecia em "Depois", com "faltam 14 dias", enquanto o relógio corria.
export function prazoDoEstudante(avaliacao) {
  if (avaliacao.situacao === 'EM_ANDAMENTO' && avaliacao.tentativa?.prazoFinal) {
    return avaliacao.tentativa.prazoFinal;
  }
  return avaliacao.dataFim;
}

// Quanto falta para o prazo, e o quanto isso é urgente.
//
// O estudante não precisa calcular a diferença entre o relógio dele e uma data no futuro
// para saber se corre risco: o sistema sabe fazer essa conta. A data continua aparecendo
// ao lado, porque "vence em 5 horas" não diz QUANDO — e é o quando que se anota.
//
// Três níveis, e não cinco: 'critico' (faltam horas), 'atencao' (é hoje ou amanhã) e
// 'normal' (há tempo). Mais faixas obrigariam o estudante a decorar uma escala.
//
// O nível é só a SEGUNDA camada de informação; a primeira é o texto. Cor sozinha não
// informa quem não distingue vermelho de laranja — e não informa ninguém em impressão.
export function urgenciaDoPrazo(dataFim, agora = new Date()) {
  const fim = new Date(dataFim);
  const faltamMinutos = Math.round((fim - agora) / 60000);

  if (faltamMinutos <= 0) return { nivel: 'critico', texto: 'Prazo encerrado' };

  if (faltamMinutos < 60) {
    return { nivel: 'critico', texto: `Vence em ${faltamMinutos} ${faltamMinutos === 1 ? 'minuto' : 'minutos'}` };
  }

  const faltamHoras = Math.floor(faltamMinutos / 60);
  if (faltamHoras < 6) {
    // Os minutos entram junto, e não são descartados: às 10:32, um prazo das 12:23 é
    // "1 hora e 51 minutos", nunca "1 hora" — a diferença entre os dois é quase uma hora
    // inteira, e é exatamente a hora que o estudante usaria para fazer a prova.
    //
    // Trunca em vez de arredondar: num prazo, errar para menos é o lado seguro. Dizer
    // "2 horas" quando faltam 1 h 51 promete tempo que não existe.
    const minutosNaHora = faltamMinutos % 60;
    const horas = `${faltamHoras} ${faltamHoras === 1 ? 'hora' : 'horas'}`;
    const minutos = `${minutosNaHora} ${minutosNaHora === 1 ? 'minuto' : 'minutos'}`;
    return { nivel: 'critico', texto: `Vence em ${minutosNaHora ? `${horas} e ${minutos}` : horas}` };
  }

  // "Hoje" e "amanhã" pelo DIA do calendário, e não por 24 horas corridas: às 23h, uma
  // prova que vence às 8h da manhã seguinte vence "amanhã", e não "em 9 horas".
  const dias = Math.round((new Date(fim).setHours(0, 0, 0, 0) - new Date(agora).setHours(0, 0, 0, 0)) / 86400000);
  if (dias === 0) return { nivel: 'critico', texto: `Vence hoje, às ${hora(fim)}` };
  if (dias === 1) return { nivel: 'atencao', texto: `Vence amanhã, às ${hora(fim)}` };
  if (dias <= 7) return { nivel: 'atencao', texto: `Faltam ${dias} dias` };
  return { nivel: 'normal', texto: `Faltam ${dias} dias` };
}

const hora = (data) =>
  data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function formatarPontos(valor) {
  const texto = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${texto} ${Number(valor) === 1 ? 'ponto' : 'pontos'}`;
}
