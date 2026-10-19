// RF11 — adaptadores dos provedores de IA.
//
// Cada serviço tem seu próprio formato de requisição e de resposta. Em vez de espalhar
// esses detalhes pelo sistema, cada um vira um adaptador com a mesma forma:
//
//     { nome, modeloPadrao, requisicao(...) -> { url, cabecalhos, corpo }, extrairTexto(json) }
//
// O resto do sistema não sabe qual está em uso — pede uma sugestão e recebe `{ nota,
// justificativa }`. Trocar de provedor é mudar uma variável de ambiente, não código.
//
// Os três cobertos são os pedidos pelo autor: **GPT** (OpenAI), **Gemini** (Google) e
// **Claude** (Anthropic). O quarto, `simulado`, não faz chamada nenhuma — existe para o
// sistema funcionar sem chave, durante o desenvolvimento e numa demonstração.

const openai = {
  nome: 'openai',
  rotulo: 'OpenAI (GPT)',
  modeloPadrao: 'gpt-4o-mini',
  requisicao({ modelo, chave, instrucao, mensagem }) {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      cabecalhos: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${chave}`,
      },
      corpo: {
        model: modelo,
        // Temperatura baixa: correção pede consistência, não criatividade — a mesma
        // resposta deve receber aproximadamente a mesma nota a cada chamada.
        temperature: 0.2,
        // Garante JSON de volta, em vez de texto com o JSON no meio.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: instrucao },
          { role: 'user', content: mensagem },
        ],
      },
    };
  },
  extrairTexto: (json) => json?.choices?.[0]?.message?.content,
};

const gemini = {
  nome: 'gemini',
  rotulo: 'Google (Gemini)',
  // "-latest" acompanha a versão atual da linha: nomes com número são descontinuados e
  // passam a responder 404. A linha "flash-lite" é a mais barata e dá conta de corrigir
  // uma discursiva curta.
  modeloPadrao: 'gemini-flash-lite-latest',
  requisicao({ modelo, chave, instrucao, mensagem }) {
    return {
      // O Gemini recebe a chave na URL, e não em cabeçalho.
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(chave)}`,
      cabecalhos: { 'Content-Type': 'application/json' },
      corpo: {
        systemInstruction: { parts: [{ text: instrucao }] },
        contents: [{ role: 'user', parts: [{ text: mensagem }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      },
    };
  },
  extrairTexto: (json) => json?.candidates?.[0]?.content?.parts?.[0]?.text,
};

const anthropic = {
  nome: 'anthropic',
  rotulo: 'Anthropic (Claude)',
  modeloPadrao: 'claude-sonnet-5',
  requisicao({ modelo, chave, instrucao, mensagem }) {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      cabecalhos: {
        'Content-Type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
      },
      corpo: {
        model: modelo,
        // Obrigatório nesta API. A justificativa tem no máximo três frases, então o
        // limite é folgado de propósito, sem desperdiçar.
        max_tokens: 1024,
        temperature: 0.2,
        system: instrucao,
        messages: [{ role: 'user', content: mensagem }],
      },
    };
  },
  extrairTexto: (json) => json?.content?.[0]?.text,
};

// Provedor sem rede: devolve uma sugestão plausível e **declaradamente fictícia**.
//
// Serve para três coisas: desenvolver sem chave, rodar os testes sem depender de serviço
// externo, e demonstrar o fluxo quando não houver crédito disponível. A nota é derivada
// do tamanho da resposta — o bastante para exercitar a tela, e nunca apresentada como
// avaliação real: a justificativa diz, com todas as letras, que é simulação.
const simulado = {
  nome: 'simulado',
  rotulo: 'Simulado (sem chamada externa)',
  modeloPadrao: 'simulado',
  simular({ resposta, pontuacaoMaxima }) {
    const palavras = String(resposta ?? '').trim().split(/\s+/).filter(Boolean).length;
    // Até 40 palavras cresce proporcionalmente; daí em diante satura em 80% da nota.
    const proporcao = Math.min(palavras / 40, 1) * 0.8;
    const nota = Math.round(pontuacaoMaxima * proporcao * 100) / 100;
    return {
      nota,
      justificativa:
        `Sugestão simulada, gerada sem consultar um serviço de Inteligência Artificial: ` +
        `a resposta tem ${palavras} palavra(s) e recebeu nota proporcional. ` +
        `Configure IA_PROVEDOR e IA_API_KEY no arquivo .env para obter uma análise real do conteúdo.`,
    };
  },
};

export const PROVEDORES = { openai, gemini, anthropic, simulado };

export const NOMES_DE_PROVEDOR = Object.keys(PROVEDORES);
