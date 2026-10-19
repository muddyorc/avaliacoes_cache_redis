// Único ponto de acesso do frontend à API.
// - credentials: 'include' envia o cookie de sessão (Etapa 1).
// - Converte o formato de erro padrão { erro, campos } em ErroApi.

export class ErroApi extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos || {};
  }
}

export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  let resposta;
  try {
    resposta = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'include',
      headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    // Falha de rede: servidor fora do ar ou conexão perdida.
    throw new ErroApi(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }

  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resposta.json() : null;

  // 502/504 sem JSON vêm do proxy (Vite/Nginx), não da API: a API está inacessível.
  if ((resposta.status === 502 || resposta.status === 504) && !dados) {
    throw new ErroApi(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }

  if (!resposta.ok) {
    throw new ErroApi(
      resposta.status,
      dados?.erro || `O servidor respondeu com erro ${resposta.status}.`,
      dados?.campos,
    );
  }
  return dados;
}
