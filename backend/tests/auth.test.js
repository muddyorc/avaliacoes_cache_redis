// Etapa 1 — RF01: autenticação, sessão, autorização por perfil, recuperação de senha,
// registro de acesso e rate limiting.
import crypto from 'node:crypto';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { solicitarRedefinicao } from '../src/modules/auth/auth.service.js';
import { criarUsuario, encerrarBanco, lerCookie, limparDados, prepararBanco } from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const PROFESSOR = { nome: 'Prof. Teste', email: 'prof@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ESTUDANTE = { nome: 'Est. Teste', email: 'est@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };
const INATIVO = {
  nome: 'Desligado',
  email: 'inativo@exemplo.com',
  senha: SENHA,
  perfil: 'ESTUDANTE',
  situacao: 'INATIVO',
};

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  await criarUsuario(PROFESSOR);
  await criarUsuario(ESTUDANTE);
  await criarUsuario(INATIVO);
});

after(async () => {
  await encerrarBanco();
});

// Faz login e devolve um agente do supertest que carrega o cookie de sessão.
async function entrar(credenciais) {
  const agente = request.agent(app);
  const resposta = await agente.post('/api/auth/login').send(credenciais);
  assert.equal(resposta.status, 200, `login deveria funcionar: ${JSON.stringify(resposta.body)}`);
  return agente;
}

// ---------------------------------------------------------------------------- login

test('login válido cria a sessão e devolve o usuário sem qualquer dado de senha', async () => {
  const resposta = await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.email, PROFESSOR.email);
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');

  const corpo = JSON.stringify(resposta.body);
  assert.doesNotMatch(corpo, /senha/i, 'a resposta não pode conter nenhum campo de senha');
  assert.doesNotMatch(corpo, /\$2[aby]\$/, 'a resposta não pode conter hash bcrypt');
  assert.equal(resposta.body.token, undefined, 'o JWT não pode vir no corpo — só no cookie httpOnly');
});

test('login aceita o e-mail com maiúsculas e espaços (o cadastro é case-insensitive)', async () => {
  const resposta = await request(app)
    .post('/api/auth/login')
    .send({ email: `  ${PROFESSOR.email.toUpperCase()}  `, senha: SENHA });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.email, PROFESSOR.email);
});

test('senha incorreta é recusada com mensagem genérica', async () => {
  const resposta = await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'errada-123' });

  assert.equal(resposta.status, 401);
  assert.equal(resposta.body.erro, 'E-mail ou senha inválidos.');
  assert.equal(lerCookie(resposta, 'sessao'), null, 'não pode criar sessão');
});

test('usuário inexistente recebe exatamente a mesma mensagem da senha incorreta', async () => {
  const inexistente = await request(app).post('/api/auth/login').send({ email: 'ninguem@exemplo.com', senha: SENHA });
  const senhaErrada = await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'errada-123' });

  assert.equal(inexistente.status, 401);
  // Mensagens diferentes revelariam quais e-mails têm conta no sistema.
  assert.equal(inexistente.body.erro, senhaErrada.body.erro);
  assert.equal(inexistente.status, senhaErrada.status);
});

test('usuário inativo não entra, mesmo com a senha correta', async () => {
  const resposta = await request(app).post('/api/auth/login').send({ email: INATIVO.email, senha: SENHA });

  assert.equal(resposta.status, 403);
  assert.match(resposta.body.erro, /inativa/i);
  assert.equal(lerCookie(resposta, 'sessao'), null);
});

test('login com corpo inválido devolve erro por campo, sem tocar no banco', async () => {
  const resposta = await request(app).post('/api/auth/login').send({ email: 'nao-e-email', senha: '' });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.email);
  assert.ok(resposta.body.campos.senha);
});

// ---------------------------------------------------------------------------- cookie

test('o cookie de sessão é httpOnly e SameSite=Strict, e o JWT não é exposto ao JavaScript', async () => {
  const resposta = await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });
  const cookie = lerCookie(resposta, 'sessao');

  assert.ok(cookie, 'o login deve enviar o cookie de sessão');
  assert.equal(cookie.httpOnly, true, 'httpOnly impede leitura por script (XSS)');
  assert.match(cookie.sameSite, /strict/i, 'SameSite=Strict protege contra CSRF');
  // O valor é um JWT (três partes separadas por ponto), mas só o navegador o manuseia.
  assert.match(cookie.valor, /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test('um cookie de sessão adulterado é recusado', async () => {
  const resposta = await request(app)
    .get('/api/auth/eu')
    .set('Cookie', 'sessao=aaa.bbb.ccc');

  assert.equal(resposta.status, 401);
});

// ------------------------------------------------------------------ rotas protegidas

test('rota protegida sem autenticação devolve 401', async () => {
  for (const rota of ['/api/auth/eu', '/api/painel/professor', '/api/painel/estudante', '/api/painel/administrador']) {
    const resposta = await request(app).get(rota);
    assert.equal(resposta.status, 401, `${rota} deveria exigir autenticação`);
  }
});

test('rota protegida com sessão válida devolve os dados do próprio usuário', async () => {
  const agente = await entrar({ email: PROFESSOR.email, senha: SENHA });
  const resposta = await agente.get('/api/auth/eu');

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.email, PROFESSOR.email);
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');
});

// ------------------------------------------------------------ autorização por perfil

test('a autorização por perfil é aplicada no backend, não apenas na interface', async () => {
  const professor = await entrar({ email: PROFESSOR.email, senha: SENHA });
  const estudante = await entrar({ email: ESTUDANTE.email, senha: SENHA });

  assert.equal((await professor.get('/api/painel/professor')).status, 200);
  assert.equal((await estudante.get('/api/painel/estudante')).status, 200);

  // O estudante chamando a rota do professor diretamente (sem passar pela interface).
  const invasao = await estudante.get('/api/painel/professor');
  assert.equal(invasao.status, 403);
  assert.match(invasao.body.erro, /permissão/i);

  assert.equal((await professor.get('/api/painel/administrador')).status, 403);
  assert.equal((await estudante.get('/api/painel/administrador')).status, 403);
});

test('o perfil vem do banco: enviá-lo no corpo ou no cabeçalho não muda nada', async () => {
  const estudante = await entrar({ email: ESTUDANTE.email, senha: SENHA });

  const resposta = await estudante
    .get('/api/painel/administrador')
    .set('X-Perfil', 'ADMINISTRADOR')
    .send({ perfil: 'ADMINISTRADOR' });

  assert.equal(resposta.status, 403);
});

test('inativar o usuário derruba a sessão em aberto na requisição seguinte', async () => {
  const agente = await entrar({ email: ESTUDANTE.email, senha: SENHA });
  assert.equal((await agente.get('/api/auth/eu')).status, 200);

  await query("UPDATE usuario SET situacao = 'INATIVO' WHERE lower(email) = $1", [ESTUDANTE.email]);

  // O JWT continua válido pela assinatura, mas o perfil é relido do banco a cada acesso.
  const depois = await agente.get('/api/auth/eu');
  assert.equal(depois.status, 401);
});

// --------------------------------------------------------------------------- logout

test('logout encerra a sessão e a rota protegida volta a exigir autenticação', async () => {
  const agente = await entrar({ email: PROFESSOR.email, senha: SENHA });
  assert.equal((await agente.get('/api/auth/eu')).status, 200);

  const saida = await agente.post('/api/auth/logout');
  assert.equal(saida.status, 200);

  const depois = await agente.get('/api/auth/eu');
  assert.equal(depois.status, 401);
});

test('logout sem sessão não quebra (idempotente)', async () => {
  assert.equal((await request(app).post('/api/auth/logout')).status, 200);
});

// ---------------------------------------------------------------- registro de acesso

test('login bem-sucedido é registrado com IP e marcado como sucesso', async () => {
  await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });

  const { rows } = await query(
    `SELECT r.sucesso, r.motivo, r.ip, r.email_informado, u.email
       FROM registro_acesso r JOIN usuario u ON u.id = r.usuario_id
      ORDER BY r.id DESC LIMIT 1`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sucesso, true);
  assert.equal(rows[0].motivo, null);
  assert.equal(rows[0].email, PROFESSOR.email);
  assert.ok(rows[0].ip, 'o IP do cliente deve ser registrado');
});

test('tentativas que falham também ficam registradas, com o motivo', async () => {
  await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'errada-123' });
  await request(app).post('/api/auth/login').send({ email: INATIVO.email, senha: SENHA });
  await request(app).post('/api/auth/login').send({ email: 'ninguem@exemplo.com', senha: SENHA });

  const { rows } = await query(
    'SELECT usuario_id, email_informado, sucesso, motivo FROM registro_acesso ORDER BY id',
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.motivo),
    ['CREDENCIAIS_INVALIDAS', 'CONTA_INATIVA', 'CREDENCIAIS_INVALIDAS'],
  );
  assert.ok(rows.every((r) => r.sucesso === false));
  // Tentativa com e-mail inexistente não tem usuário, mas o e-mail digitado é preservado.
  assert.equal(rows[2].usuario_id, null);
  assert.equal(rows[2].email_informado, 'ninguem@exemplo.com');
});

test('o registro de acesso nunca guarda a senha digitada', async () => {
  await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });

  const { rows } = await query('SELECT * FROM registro_acesso');
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(SENHA));
});

// ------------------------------------------------------------ recuperação de senha

test('pedido de recuperação responde igual para e-mail existente e inexistente', async () => {
  const existe = await request(app).post('/api/auth/recuperacao').send({ email: PROFESSOR.email });
  const naoExiste = await request(app).post('/api/auth/recuperacao').send({ email: 'ninguem@exemplo.com' });

  assert.equal(existe.status, 200);
  assert.equal(naoExiste.status, 200);
  assert.deepEqual(existe.body, naoExiste.body);
});

test('a resposta da recuperação nunca contém o token nem o link', async () => {
  const resposta = await request(app).post('/api/auth/recuperacao').send({ email: PROFESSOR.email });

  const corpo = JSON.stringify(resposta.body);
  assert.doesNotMatch(corpo, /token/i);
  assert.doesNotMatch(corpo, /redefinir-senha\?/i);
});

test('o banco guarda apenas o hash do token, nunca o token em si', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  const { rows } = await query('SELECT token_hash, expira_em, usado_em FROM token_redefinicao_senha');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(rows[0].usado_em, null);
  assert.ok(rows[0].expira_em > new Date(), 'o token deve ter validade futura');
});

test('token de recuperação válido redefine a senha e permite entrar com a nova', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  assert.equal((await request(app).post('/api/auth/redefinicao/verificar').send({ token })).status, 200);

  const nova = 'nova-senha-456';
  const redefinicao = await request(app).post('/api/auth/redefinicao').send({ token, senha: nova });
  assert.equal(redefinicao.status, 200);

  // A senha antiga deixa de valer e a nova passa a valer.
  assert.equal((await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: nova })).status, 200);

  // A nova senha é gravada como hash, nunca em texto puro.
  const { rows } = await query('SELECT senha_hash FROM usuario WHERE lower(email) = $1', [PROFESSOR.email]);
  assert.notEqual(rows[0].senha_hash, nova);
  assert.match(rows[0].senha_hash, /^\$2[aby]\$/);
  assert.ok(await bcrypt.compare(nova, rows[0].senha_hash));
});

test('token já utilizado não funciona uma segunda vez', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  assert.equal((await request(app).post('/api/auth/redefinicao').send({ token, senha: 'nova-senha-456' })).status, 200);

  const reuso = await request(app).post('/api/auth/redefinicao').send({ token, senha: 'outra-senha-789' });
  assert.equal(reuso.status, 400);
  assert.match(reuso.body.erro, /inválido ou expirou/i);

  // A segunda tentativa não pode ter alterado a senha.
  assert.equal(
    (await request(app).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'outra-senha-789' })).status,
    401,
  );
});

test('token expirado é recusado', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  // Envelhece o token diretamente no banco, em vez de esperar uma hora.
  await query("UPDATE token_redefinicao_senha SET expira_em = now() - interval '1 minute'");

  const resposta = await request(app).post('/api/auth/redefinicao').send({ token, senha: 'nova-senha-456' });
  assert.equal(resposta.status, 400);
  assert.match(resposta.body.erro, /inválido ou expirou/i);
});

test('pedir um novo link invalida o anterior', async () => {
  const primeiro = await solicitarRedefinicao({ email: PROFESSOR.email });
  const tokenAntigo = new URL(primeiro.linkDesenvolvimento).searchParams.get('token');
  const segundo = await solicitarRedefinicao({ email: PROFESSOR.email });
  const tokenNovo = new URL(segundo.linkDesenvolvimento).searchParams.get('token');

  assert.equal((await request(app).post('/api/auth/redefinicao').send({ token: tokenAntigo, senha: 'x-123456789' })).status, 400);
  assert.equal((await request(app).post('/api/auth/redefinicao').send({ token: tokenNovo, senha: 'x-123456789' })).status, 200);
});

test('token inexistente e token expirado devolvem a mesma mensagem', async () => {
  const inexistente = await request(app)
    .post('/api/auth/redefinicao')
    .send({ token: 'token-que-nunca-existiu', senha: 'nova-senha-456' });

  assert.equal(inexistente.status, 400);
  assert.match(inexistente.body.erro, /inválido ou expirou/i);
});

test('usuário inativo não recebe link de redefinição', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: INATIVO.email });

  assert.equal(linkDesenvolvimento, null);
  const { rows } = await query('SELECT count(*)::int AS total FROM token_redefinicao_senha');
  assert.equal(rows[0].total, 0);
});

test('a nova senha precisa ter pelo menos 8 caracteres', async () => {
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  const resposta = await request(app).post('/api/auth/redefinicao').send({ token, senha: 'curta' });
  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.senha);

  // O token não pode ter sido consumido por uma tentativa inválida.
  assert.equal((await request(app).post('/api/auth/redefinicao').send({ token, senha: 'agora-valida-123' })).status, 200);
});

// --------------------------------------------------------------------- rate limiting

test('tentativas de login em excesso são bloqueadas com 429', async () => {
  const restrito = criarApp({ limites: { loginMax: 3, janelaMinutos: 15 } });

  for (let i = 0; i < 3; i += 1) {
    const resposta = await request(restrito).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'errada-123' });
    assert.equal(resposta.status, 401, `tentativa ${i + 1} deveria apenas falhar`);
  }

  const bloqueada = await request(restrito).post('/api/auth/login').send({ email: PROFESSOR.email, senha: 'errada-123' });
  assert.equal(bloqueada.status, 429);
  assert.match(bloqueada.body.erro, /muitas tentativas/i);

  // Mesmo com a senha correta o acesso segue bloqueado enquanto durar a janela.
  const comSenhaCerta = await request(restrito).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });
  assert.equal(comSenhaCerta.status, 429);
});

test('logins bem-sucedidos não consomem o limite de tentativas', async () => {
  const restrito = criarApp({ limites: { loginMax: 2, janelaMinutos: 15 } });

  for (let i = 0; i < 5; i += 1) {
    const resposta = await request(restrito).post('/api/auth/login').send({ email: PROFESSOR.email, senha: SENHA });
    assert.equal(resposta.status, 200, 'acertar a senha nunca pode bloquear o usuário');
  }
});

test('pedidos de recuperação de senha em excesso são bloqueados com 429', async () => {
  const restrito = criarApp({ limites: { recuperacaoMax: 2, janelaMinutos: 15 } });

  assert.equal((await request(restrito).post('/api/auth/recuperacao').send({ email: PROFESSOR.email })).status, 200);
  assert.equal((await request(restrito).post('/api/auth/recuperacao').send({ email: PROFESSOR.email })).status, 200);

  const bloqueada = await request(restrito).post('/api/auth/recuperacao').send({ email: PROFESSOR.email });
  assert.equal(bloqueada.status, 429);
});

test('esgotar o limite de envio de e-mail não impede concluir uma redefinição em andamento', async () => {
  // Cenário real: a pessoa pede o link algumas vezes (não recebe, tenta de novo) e só
  // então abre o link. Se os dois endpoints dividissem o mesmo contador, ela ficaria
  // travada justamente na hora de cadastrar a nova senha.
  const restrito = criarApp({ limites: { recuperacaoMax: 1, redefinicaoMax: 10, janelaMinutos: 15 } });

  // Esgota o orçamento de envio de e-mail.
  assert.equal((await request(restrito).post('/api/auth/recuperacao').send({ email: PROFESSOR.email })).status, 200);
  assert.equal((await request(restrito).post('/api/auth/recuperacao').send({ email: PROFESSOR.email })).status, 429);

  // Só agora gera o link que a pessoa tem em mãos (o último pedido aceito é o que vale).
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: PROFESSOR.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  // Com contador próprio, concluir a redefinição continua possível.
  assert.equal((await request(restrito).post('/api/auth/redefinicao/verificar').send({ token })).status, 200);
  assert.equal((await request(restrito).post('/api/auth/redefinicao').send({ token, senha: 'nova-senha-456' })).status, 200);
});
