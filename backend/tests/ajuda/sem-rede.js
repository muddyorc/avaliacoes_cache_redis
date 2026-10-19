// Trava de rede dos testes automatizados.
//
// Nenhum teste deste projeto pode consultar um serviço de IA de verdade. O motivo é
// prático e também de método: a chamada custa dinheiro a cada execução, depende de uma
// chave que nem sempre existe, e o resultado de um modelo de linguagem varia entre
// chamadas — um teste que dependesse disso falharia sozinho, sem nada ter quebrado.
//
// O que os testes verificam é o que **o sistema faz** com a resposta: se valida, se
// recusa nota impossível, se grava, se protege o estudante. Para isso, a resposta do
// serviço é simulada por um dublê.
//
// Este arquivo é carregado antes de qualquer teste (ver `scripts/testar.js`) e substitui
// o `fetch` global por uma versão que **recusa** sair para a internet. Assim, se algum
// teste esquecer de instalar o dublê, ele falha imediatamente com uma mensagem clara, em
// vez de gastar crédito silenciosamente.
//
// Os testes que precisam de um dublê simplesmente sobrescrevem `globalThis.fetch`; ao
// restaurarem o valor original, restauram esta trava.
const fetchReal = globalThis.fetch;

function ehLocal(url) {
  const texto = String(url);
  return texto.startsWith('http://localhost') || texto.startsWith('http://127.0.0.1');
}

globalThis.fetch = async (url, opcoes) => {
  if (ehLocal(url)) return fetchReal(url, opcoes);
  throw new Error(
    `[testes] chamada de rede bloqueada: ${url}\n` +
      '        Nenhum teste pode consultar um serviço externo — isso gastaria crédito e\n' +
      '        tornaria o resultado dependente da resposta de um modelo.\n' +
      '        Use o provedor "simulado" ou substitua globalThis.fetch por um dublê.',
  );
};

// Também garante o padrão seguro: sem configuração explícita no teste, o sistema usa o
// provedor simulado, que não faz chamada nenhuma.
process.env.IA_PROVEDOR = process.env.IA_PROVEDOR || 'simulado';
