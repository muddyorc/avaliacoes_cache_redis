// Leitura centralizada das variáveis de ambiente.
// Carrega o .env da raiz do projeto quando ele existe (process.loadEnvFile, nativo do Node 22).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arquivoEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(arquivoEnv)) {
  // Não sobrescreve variáveis já definidas no processo.
  process.loadEnvFile(arquivoEnv);
}

function obrigatoria(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome}. Consulte o .env.example.`);
  }
  return valor;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const emTeste = nodeEnv === 'test';

// Os testes automatizados JAMAIS tocam o banco de desenvolvimento: eles apagam os dados
// a cada execução (DT21). O isolamento é garantido aqui, no único ponto que resolve a URL.
function resolverUrlDoBanco() {
  if (!emTeste) return obrigatoria('DATABASE_URL');

  const urlTeste = obrigatoria('DATABASE_URL_TESTE');
  if (urlTeste === process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_TESTE aponta para o mesmo banco de DATABASE_URL. ' +
        'Os testes apagam dados: use um banco separado (ex.: avaliacoes_teste).',
    );
  }
  return urlTeste;
}

export const env = {
  nodeEnv,
  porta: Number(process.env.PORT || 3000),
  databaseUrl: resolverUrlDoBanco(),
  // Segredo do JWT. Sem valor padrão de propósito: um padrão embutido seria uma chave
  // conhecida capaz de forjar sessões de qualquer usuário.
  jwtSecret: obrigatoria('JWT_SECRET'),
  // Duração da sessão: 8 h (PROJECT_CONTEXT §3.2) — cobre um turno de aula sem reautenticar.
  sessaoSegundos: Number(process.env.SESSAO_SEGUNDOS || 8 * 60 * 60),
  // Validade do link de redefinição de senha: 1 h (PROJECT_CONTEXT §3.2).
  redefinicaoSegundos: Number(process.env.REDEFINICAO_SEGUNDOS || 60 * 60),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  admin: {
    nome: process.env.ADMIN_NOME || 'Administrador',
    email: process.env.ADMIN_EMAIL || '',
    senha: process.env.ADMIN_SENHA || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    porta: Number(process.env.SMTP_PORT || 587),
    usuario: process.env.SMTP_USER || '',
    senha: process.env.SMTP_PASS || '',
    remetente: process.env.SMTP_FROM || 'Sistema de Avaliacoes <nao-responda@exemplo.com>',
  },
  // Rate limit do login e da recuperação de senha (RF01, proteção contra abuso).
  // Nos testes o limite padrão é alto para não interferir nos demais casos; o teste
  // específico de rate limiting monta um app com limites próprios.
  limites: {
    janelaMinutos: Number(process.env.RATE_LIMIT_JANELA_MIN || 15),
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX || (emTeste ? 1000 : 10)),
    // Pedir o link dispara envio de e-mail: limite baixo, para não virar ferramenta de spam.
    recuperacaoMax: Number(process.env.RATE_LIMIT_RECUPERACAO_MAX || (emTeste ? 1000 : 5)),
    // Verificar e gravar a nova senha não enviam nada e são protegidos pela entropia do
    // token (256 bits). Limite próprio e mais folgado: completar o fluxo exige 2 chamadas,
    // e errar a nova senha uma vez não pode travar quem está legitimamente redefinindo.
    redefinicaoMax: Number(process.env.RATE_LIMIT_REDEFINICAO_MAX || (emTeste ? 1000 : 20)),
    // Autocadastro de estudante (RF02): cria contas, então precisa de teto próprio.
    cadastroMax: Number(process.env.RATE_LIMIT_CADASTRO_MAX || (emTeste ? 1000 : 5)),
    // Entrada em turma por código (RF06): impede adivinhar códigos por tentativa e erro.
    codigoTurmaMax: Number(process.env.RATE_LIMIT_CODIGO_TURMA_MAX || (emTeste ? 1000 : 20)),
  },
};

export const emProducao = nodeEnv === 'production';
export const emAmbienteDeTeste = emTeste;
