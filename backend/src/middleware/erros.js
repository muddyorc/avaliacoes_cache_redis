// Formato padrão de erro da API (PROJECT_CONTEXT §3.2, RNF06):
//   { "erro": "mensagem legível", "campos": { "email": "..." } }   (campos é opcional)

// Erro esperado de regra de negócio/validação. Os serviços lançam `new ErroApp(409, '...')`.
export class ErroApp extends Error {
  constructor(status, mensagem, campos) {
    super(mensagem);
    this.status = status;
    this.campos = campos;
  }
}

export function rotaNaoEncontrada(req, res) {
  res.status(404).json({ erro: 'Recurso não encontrado.' });
}

// eslint-disable-next-line no-unused-vars
export function tratarErros(erro, req, res, next) {
  if (erro instanceof ErroApp) {
    const corpo = { erro: erro.message };
    if (erro.campos) corpo.campos = erro.campos;
    return res.status(erro.status).json(corpo);
  }
  // JSON malformado no corpo da requisição.
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'O corpo da requisição não é um JSON válido.' });
  }
  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'O conteúdo enviado excede o tamanho permitido.' });
  }
  // Erro inesperado: registra no servidor, nunca expõe detalhes internos ao cliente.
  console.error('[erro]', erro);
  return res.status(500).json({ erro: 'Erro interno do servidor. Tente novamente.' });
}
