// Validação de entrada com zod, convertida para o formato de erro padrão da API
// { erro, campos } (PROJECT_CONTEXT §3.1, RNF06).
import { z } from 'zod';
import { ErroApp } from '../middleware/erros.js';

export { z };

// Valida `dados` contra `esquema`. Em caso de falha lança ErroApp 400 com a mensagem
// de cada campo, em português, pronta para ser exibida ao lado do input.
export function validar(esquema, dados) {
  const resultado = esquema.safeParse(dados);
  if (resultado.success) return resultado.data;

  const campos = {};
  for (const problema of resultado.error.issues) {
    const campo = problema.path.join('.') || 'corpo';
    // Mantém a primeira mensagem de cada campo: é a mais específica.
    if (!campos[campo]) campos[campo] = problema.message;
  }
  throw new ErroApp(400, 'Verifique os dados informados.', campos);
}

// Regras de senha compartilhadas entre o cadastro do admin (seed) e a redefinição.
// Mínimo de 8 caracteres é o piso já adotado no projeto desde a Etapa 0 (seed.js).
export const SENHA_MINIMA = 8;

export const esquemaSenha = z
  .string({ error: 'Informe a nova senha.' })
  .min(SENHA_MINIMA, `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`)
  .max(200, 'A senha é longa demais.');

export const esquemaEmail = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .min(1, 'Informe o e-mail.')
  .max(254, 'O e-mail é longo demais.')
  .pipe(z.email({ error: 'Informe um e-mail válido.' }))
  .transform((valor) => valor.toLowerCase());
