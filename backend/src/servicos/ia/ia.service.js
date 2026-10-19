// RF11 / UC11 — a sugestão de nota por Inteligência Artificial.
//
// O que este módulo garante, independentemente do provedor configurado:
//
//   - **A resposta do serviço externo nunca é confiada.** Ela é validada antes de voltar:
//     JSON legível, nota numérica dentro do intervalo da questão, justificativa com
//     tamanho razoável. Um modelo de linguagem às vezes devolve texto onde se pediu
//     número, ou nota 12 numa questão de 3 pontos — e isso não pode chegar ao professor
//     como se fosse avaliação.
//   - **Indisponibilidade não quebra a correção** (UC11 A5). Qualquer falha — rede, chave
//     inválida, demora, formato inesperado — vira a mesma resposta: "não foi possível
//     obter a sugestão; corrija manualmente".
//   - **Nada identifica o estudante.** O que é enviado está em `prompt.js`, e nome,
//     e-mail e identificador não são sequer parâmetros desta função.
//
// A nota devolvida é **sugestão**. Quem decide é o professor (RN04, P-08).
import { ErroApp } from '../../middleware/erros.js';
import { instrucao, montarMensagem } from './prompt.js';
import { PROVEDORES, NOMES_DE_PROVEDOR } from './provedores.js';

const INDISPONIVEL =
  'Não foi possível obter a sugestão da Inteligência Artificial agora. Faça a correção manualmente.';

// Justificativa longa demais é sinal de que o modelo fugiu do formato; o limite protege
// a tela e o banco, e o corte preserva o começo, que é a parte útil.
const LIMITE_JUSTIFICATIVA = 2000;

// A configuração é lida a cada chamada, e não na carga do módulo: assim o provedor pode
// ser trocado no `.env` sem reiniciar raciocínio nenhum, e os testes conseguem exercitar
// cada provedor sem recarregar a aplicação.
export function configuracaoIA() {
  const provedor = (process.env.IA_PROVEDOR || '').trim().toLowerCase();
  const chave = (process.env.IA_API_KEY || '').trim();

  // Sem provedor declarado, ou declarado sem chave, o sistema usa o simulado. É o que
  // permite desenvolver e demonstrar antes de a chave existir — sempre avisando na
  // própria justificativa que a sugestão é fictícia.
  if (!provedor || provedor === 'simulado') return { provedor: PROVEDORES.simulado, simulado: true };
  if (!PROVEDORES[provedor]) {
    throw new ErroApp(
      500,
      `Provedor de IA desconhecido: "${provedor}". Use um destes: ${NOMES_DE_PROVEDOR.join(', ')}.`,
    );
  }
  if (!chave) return { provedor: PROVEDORES.simulado, simulado: true, motivo: 'IA_API_KEY não configurada' };

  const escolhido = PROVEDORES[provedor];
  return {
    provedor: escolhido,
    simulado: false,
    chave,
    modelo: (process.env.IA_MODELO || '').trim() || escolhido.modeloPadrao,
    timeout: Number(process.env.IA_TIMEOUT_MS || 25000),
  };
}

// Lê a nota e a justificativa do texto devolvido pelo modelo.
//
// Alguns modelos embrulham o JSON em bloco de código, mesmo instruídos a não fazer isso;
// por isso o texto é limpo antes de interpretado. Se ainda assim não for JSON válido, a
// chamada é tratada como indisponível.
export function interpretarResposta(texto, pontuacaoMaxima) {
  if (!texto || typeof texto !== 'string') return null;

  const limpo = texto
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  let dados;
  try {
    dados = JSON.parse(limpo);
  } catch {
    return null;
  }

  const nota = Number(dados?.nota);
  if (!Number.isFinite(nota)) return null;
  // Fora do intervalo não é arredondado para caber: é descartado. Uma nota 12 numa
  // questão de 3 pontos significa que o modelo não entendeu a tarefa, e "consertar" o
  // número esconderia isso do professor.
  if (nota < 0 || nota > Number(pontuacaoMaxima)) return null;

  const justificativa = String(dados?.justificativa ?? '').trim();
  if (!justificativa) return null;

  return {
    nota: Math.round(nota * 100) / 100,
    justificativa: justificativa.slice(0, LIMITE_JUSTIFICATIVA),
  };
}

/**
 * Pede ao provedor configurado uma sugestão de nota.
 *
 * @returns {{nota:number, justificativa:string, modelo:string, simulada:boolean}}
 * @throws {ErroApp} 503 quando o serviço não responde ou responde fora do formato (A5)
 */
// Extrai do corpo de um erro HTTP o texto que explica o que aconteceu.
//
// Vale a pena registrar isso: foi exatamente a mensagem do provedor ("este modelo não
// está mais disponível, use outro") que explicou uma falha que o código de status, só
// ele, não explicava. A chave é apagada antes, porque em um dos provedores ela viaja na
// URL e pode voltar ecoada no erro.
function motivoDoErro(corpo, chave) {
  const texto = String(corpo ?? '').replace(/\s+/g, ' ').trim();
  const limpo = chave ? texto.split(chave).join('<chave>') : texto;
  if (!limpo) return '(sem corpo na resposta)';
  return limpo.length > 300 ? `${limpo.slice(0, 300)}…` : limpo;
}

export async function sugerirNota({ tema, enunciado, respostaEsperada, criterios, pontuacaoMaxima, resposta }) {
  const config = configuracaoIA();

  if (config.simulado) {
    const { nota, justificativa } = config.provedor.simular({ resposta, pontuacaoMaxima });
    return { nota, justificativa, modelo: 'simulado', simulada: true };
  }

  const mensagem = montarMensagem({ tema, enunciado, respostaEsperada, criterios, pontuacaoMaxima, resposta });
  const { url, cabecalhos, corpo } = config.provedor.requisicao({
    modelo: config.modelo,
    chave: config.chave,
    // A instrução é montada a cada chamada porque o contexto muda com a questão: a mesma
    // frase vale coisas diferentes em Geografia e em Direito.
    instrucao: instrucao(tema),
    mensagem,
  });

  // Tempo limite próprio: a correção é feita com o professor esperando na tela, e um
  // serviço lento não pode travar o trabalho dele.
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), config.timeout);

  let json;
  try {
    const resposta_http = await fetch(url, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
    if (!resposta_http.ok) {
      // O professor recebe sempre a mensagem neutra; o motivo fica no log do servidor,
      // onde é útil. O corpo do erro pode repetir a chave (ela viaja na URL em um dos
      // provedores), então ela é removida antes de registrar — e o texto é cortado, já
      // que a parte que interessa vem no início.
      console.error(
        `[ia] ${config.provedor.nome} respondeu ${resposta_http.status}: ${motivoDoErro(
          await resposta_http.text(),
          config.chave,
        )}`,
      );
      throw new ErroApp(503, INDISPONIVEL);
    }
    json = await resposta_http.json();
  } catch (erro) {
    if (erro instanceof ErroApp) throw erro;
    console.error(`[ia] falha ao consultar ${config.provedor.nome}: ${erro.name}`);
    throw new ErroApp(503, INDISPONIVEL);
  } finally {
    clearTimeout(relogio);
  }

  const interpretada = interpretarResposta(config.provedor.extrairTexto(json), pontuacaoMaxima);
  if (!interpretada) {
    console.error(`[ia] ${config.provedor.nome} devolveu resposta fora do formato esperado`);
    throw new ErroApp(503, INDISPONIVEL);
  }

  return { ...interpretada, modelo: config.modelo, simulada: false };
}

// Usada pela tela de correção para dizer ao professor com o que ele está trabalhando.
export function estadoDaIA() {
  const config = configuracaoIA();
  return {
    disponivel: true,
    simulada: config.simulado,
    provedor: config.provedor.rotulo,
    modelo: config.simulado ? null : config.modelo,
  };
}
