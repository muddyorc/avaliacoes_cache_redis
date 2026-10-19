// Etapa 2 — RF02: gestão de usuários pelo administrador, autocadastro do estudante
// e edição dos próprios dados.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { criarApp } from '../src/app.js';
import { query } from '../src/db/pool.js';
import { criarUsuario, encerrarBanco, limparDados, prepararBanco } from './ajuda/banco.js';

const app = criarApp();

const SENHA = 'senha-boa-123';
const ADMIN = { nome: 'Admin Dois', email: 'admin2@exemplo.com', senha: SENHA, perfil: 'ADMINISTRADOR' };
const PROFESSOR = { nome: 'Prof. Teste', email: 'prof@exemplo.com', senha: SENHA, perfil: 'PROFESSOR' };
const ESTUDANTE = { nome: 'Est. Teste', email: 'est@exemplo.com', senha: SENHA, perfil: 'ESTUDANTE' };

let idAdmin;
let idProfessor;
let idEstudante;

before(async () => {
  await prepararBanco();
});

beforeEach(async () => {
  await limparDados();
  idAdmin = (await criarUsuario(ADMIN)).id;
  idProfessor = (await criarUsuario(PROFESSOR)).id;
  idEstudante = (await criarUsuario(ESTUDANTE)).id;
});

after(async () => {
  await encerrarBanco();
});

async function entrar({ email, senha = SENHA }) {
  const agente = request.agent(app);
  const resposta = await agente.post('/api/auth/login').send({ email, senha });
  assert.equal(resposta.status, 200, `login falhou: ${JSON.stringify(resposta.body)}`);
  return agente;
}

const comoAdmin = () => entrar({ email: ADMIN.email });
const comoProfessor = () => entrar({ email: PROFESSOR.email });
const comoEstudante = () => entrar({ email: ESTUDANTE.email });

// ------------------------------------------------------------------ autocadastro (UC03)

test('estudante se autocadastra e já consegue entrar', async () => {
  const novo = { nome: 'Maria Silva', email: 'maria@exemplo.com', senha: 'senha-nova-123' };

  const cadastro = await request(app).post('/api/usuarios/cadastro').send(novo);
  assert.equal(cadastro.status, 201);
  assert.equal(cadastro.body.usuario.perfil, 'ESTUDANTE');
  assert.equal(cadastro.body.usuario.situacao, 'ATIVO');

  const login = await request(app).post('/api/auth/login').send({ email: novo.email, senha: novo.senha });
  assert.equal(login.status, 200);
});

// O P-18 (professor só criado por administrador) foi revertido em 13/10/2026: cadastrar
// professor a professor não escala. O que NÃO mudou, e é o que estes testes guardam, é a
// impossibilidade de nascer administrador por uma rota pública.

test('o professor se autocadastra e entra, como o estudante', async () => {
  const email = 'prof.novo@exemplo.com';
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Prof. Novo', email, senha: 'senha-nova-123', perfil: 'PROFESSOR' });

  assert.equal(resposta.status, 201);
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');
  assert.equal(resposta.body.usuario.situacao, 'ATIVO', 'nasce ativo: não depende de aprovação');

  // Confirma no banco, não só na resposta.
  const { rows } = await query('SELECT perfil FROM usuario WHERE lower(email) = $1', [email]);
  assert.equal(rows[0].perfil, 'PROFESSOR');

  const login = await request(app).post('/api/auth/login').send({ email, senha: 'senha-nova-123' });
  assert.equal(login.status, 200, 'entra na hora, sem passo intermediário');
});

test('a rota pública de cadastro nunca cria administrador', async () => {
  const email = 'tentativa.admin@exemplo.com';
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Tentativa', email, senha: 'senha-nova-123', perfil: 'ADMINISTRADOR' });

  assert.equal(resposta.status, 400, 'perfil fora da lista pública é recusado');
  assert.ok(resposta.body.campos?.perfil);

  // A conta não pode ter sido criada de forma alguma — nem como estudante.
  const { rows } = await query('SELECT perfil FROM usuario WHERE lower(email) = $1', [email]);
  assert.equal(rows.length, 0);
});

test('o autocadastro sem perfil continua criando estudante', async () => {
  const email = 'sem.perfil@exemplo.com';
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Sem Perfil', email, senha: 'senha-nova-123' });

  assert.equal(resposta.status, 201);
  assert.equal(resposta.body.usuario.perfil, 'ESTUDANTE', 'o padrão não mudou');
});

test('o autocadastro não aceita a situação enviada pelo cliente', async () => {
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Tentativa', email: 'situacao@exemplo.com', senha: 'senha-nova-123', situacao: 'INATIVO' });

  assert.equal(resposta.status, 201);
  assert.equal(resposta.body.usuario.situacao, 'ATIVO');
});

test('autocadastro com e-mail já usado devolve 409 com mensagem no campo', async () => {
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Outro', email: ESTUDANTE.email.toUpperCase(), senha: 'senha-nova-123' });

  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /já existe/i);
  assert.ok(resposta.body.campos.email);
});

test('autocadastro valida nome, e-mail e senha', async () => {
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'A', email: 'sem-arroba', senha: 'curta' });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.nome);
  assert.ok(resposta.body.campos.email);
  assert.ok(resposta.body.campos.senha);
});

test('a senha do autocadastro é gravada como hash e nunca volta na resposta', async () => {
  const resposta = await request(app)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Maria Silva', email: 'maria@exemplo.com', senha: 'senha-nova-123' });

  assert.doesNotMatch(JSON.stringify(resposta.body), /senha|\$2[aby]\$/i);

  const { rows } = await query('SELECT senha_hash FROM usuario WHERE lower(email) = $1', ['maria@exemplo.com']);
  assert.match(rows[0].senha_hash, /^\$2[aby]\$/);
  assert.ok(await bcrypt.compare('senha-nova-123', rows[0].senha_hash));
});

// ------------------------------------------------------------------- listagem (UC02)

test('somente o administrador lista usuários', async () => {
  assert.equal((await request(app).get('/api/usuarios')).status, 401);
  assert.equal((await (await comoProfessor()).get('/api/usuarios')).status, 403);
  assert.equal((await (await comoEstudante()).get('/api/usuarios')).status, 403);
  assert.equal((await (await comoAdmin()).get('/api/usuarios')).status, 200);
});

test('a listagem nunca inclui o hash da senha', async () => {
  const resposta = await (await comoAdmin()).get('/api/usuarios');

  assert.equal(resposta.status, 200);
  assert.ok(resposta.body.usuarios.length >= 4);
  assert.doesNotMatch(JSON.stringify(resposta.body), /senha_hash|\$2[aby]\$/);
});

test('a listagem filtra por perfil, por situação e por busca', async () => {
  const admin = await comoAdmin();
  await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'INATIVO' });

  const professores = await admin.get('/api/usuarios').query({ perfil: 'PROFESSOR' });
  assert.deepEqual(professores.body.usuarios.map((u) => u.email), [PROFESSOR.email]);

  const inativos = await admin.get('/api/usuarios').query({ situacao: 'INATIVO' });
  assert.deepEqual(inativos.body.usuarios.map((u) => u.email), [ESTUDANTE.email]);

  // A busca cobre nome e e-mail, sem diferenciar maiúsculas.
  const porNome = await admin.get('/api/usuarios').query({ busca: 'PROF.' });
  assert.deepEqual(porNome.body.usuarios.map((u) => u.email), [PROFESSOR.email]);

  const porEmail = await admin.get('/api/usuarios').query({ busca: 'est@' });
  assert.deepEqual(porEmail.body.usuarios.map((u) => u.email), [ESTUDANTE.email]);
});

test('a listagem pagina e informa o total', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.get('/api/usuarios').query({ pagina: 1, tamanho: 2 });

  assert.equal(resposta.body.usuarios.length, 2);
  assert.equal(resposta.body.total, 4); // admin do seed + os três criados
  assert.equal(resposta.body.paginas, 2);

  const segunda = await admin.get('/api/usuarios').query({ pagina: 2, tamanho: 2 });
  assert.equal(segunda.body.usuarios.length, 2);

  const primeiros = resposta.body.usuarios.map((u) => u.id);
  assert.ok(segunda.body.usuarios.every((u) => !primeiros.includes(u.id)), 'as páginas não podem se repetir');
});

// -------------------------------------------------------- criação pelo administrador

test('administrador cadastra professor, que passa a entrar no sistema', async () => {
  const admin = await comoAdmin();
  const novo = { nome: 'Novo Professor', email: 'novo.prof@exemplo.com', senha: 'senha-nova-123', perfil: 'PROFESSOR' };

  const criacao = await admin.post('/api/usuarios').send(novo);
  assert.equal(criacao.status, 201);
  assert.equal(criacao.body.usuario.perfil, 'PROFESSOR');

  const agente = await entrar({ email: novo.email, senha: novo.senha });
  assert.equal((await agente.get('/api/painel/professor')).status, 200);
});

test('administrador pode cadastrar já inativo, e essa conta não entra', async () => {
  const admin = await comoAdmin();
  const novo = { nome: 'Futuro Aluno', email: 'futuro@exemplo.com', senha: 'senha-nova-123', perfil: 'ESTUDANTE', situacao: 'INATIVO' };

  assert.equal((await admin.post('/api/usuarios').send(novo)).status, 201);

  const login = await request(app).post('/api/auth/login').send({ email: novo.email, senha: novo.senha });
  assert.equal(login.status, 403);
});

test('perfil fora dos três permitidos é recusado (P-17)', async () => {
  const admin = await comoAdmin();
  const resposta = await admin
    .post('/api/usuarios')
    .send({ nome: 'Coordenador', email: 'coord@exemplo.com', senha: 'senha-nova-123', perfil: 'COORDENADOR' });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.perfil);
});

test('professor e estudante não conseguem criar contas', async () => {
  const novo = { nome: 'Invasor', email: 'invasor@exemplo.com', senha: 'senha-nova-123', perfil: 'ADMINISTRADOR' };

  assert.equal((await (await comoProfessor()).post('/api/usuarios').send(novo)).status, 403);
  assert.equal((await (await comoEstudante()).post('/api/usuarios').send(novo)).status, 403);

  const { rows } = await query('SELECT count(*)::int AS total FROM usuario WHERE lower(email) = $1', [novo.email]);
  assert.equal(rows[0].total, 0);
});

// --------------------------------------------------------- edição pelo administrador

test('administrador edita nome, e-mail e perfil de outro usuário', async () => {
  const admin = await comoAdmin();
  const resposta = await admin
    .patch(`/api/usuarios/${idEstudante}`)
    .send({ nome: 'Nome Corrigido', email: 'corrigido@exemplo.com', perfil: 'PROFESSOR' });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.nome, 'Nome Corrigido');
  assert.equal(resposta.body.usuario.email, 'corrigido@exemplo.com');
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');

  // A mudança de perfil vale de imediato nas rotas protegidas.
  const agente = await entrar({ email: 'corrigido@exemplo.com' });
  assert.equal((await agente.get('/api/painel/professor')).status, 200);
  assert.equal((await agente.get('/api/painel/estudante')).status, 403);
});

test('edição parcial altera só o campo enviado', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.patch(`/api/usuarios/${idProfessor}`).send({ nome: 'Só o Nome' });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.nome, 'Só o Nome');
  assert.equal(resposta.body.usuario.email, PROFESSOR.email);
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');
});

test('edição sem nenhum campo é recusada', async () => {
  const admin = await comoAdmin();
  assert.equal((await admin.patch(`/api/usuarios/${idProfessor}`).send({})).status, 400);
});

test('editar para um e-mail já usado devolve 409', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.patch(`/api/usuarios/${idProfessor}`).send({ email: ESTUDANTE.email });

  assert.equal(resposta.status, 409);
  assert.ok(resposta.body.campos.email);
});

test('usuário inexistente devolve 404 na consulta e na edição', async () => {
  const admin = await comoAdmin();
  assert.equal((await admin.get('/api/usuarios/999999')).status, 404);
  assert.equal((await admin.patch('/api/usuarios/999999').send({ nome: 'Fantasma' })).status, 404);
  assert.equal((await admin.patch('/api/usuarios/999999/situacao').send({ situacao: 'INATIVO' })).status, 404);
});

test('id não numérico devolve 400, não 500', async () => {
  const admin = await comoAdmin();
  assert.equal((await admin.get('/api/usuarios/abc')).status, 400);
});

// ------------------------------------------------------ ativação e inativação (P-02)

test('inativar é a "exclusão" do sistema: o registro continua no banco', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'INATIVO' });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.situacao, 'INATIVO');

  const { rows } = await query('SELECT situacao FROM usuario WHERE id = $1', [idEstudante]);
  assert.equal(rows.length, 1, 'o registro não pode ser apagado fisicamente');
  assert.equal(rows[0].situacao, 'INATIVO');
});

test('usuário inativado perde o acesso imediatamente e não consegue entrar de novo', async () => {
  const estudante = await comoEstudante();
  assert.equal((await estudante.get('/api/auth/eu')).status, 200);

  const admin = await comoAdmin();
  await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'INATIVO' });

  // Sessão já aberta cai na requisição seguinte.
  assert.equal((await estudante.get('/api/auth/eu')).status, 401);
  // E um novo login é barrado.
  assert.equal((await request(app).post('/api/auth/login').send({ email: ESTUDANTE.email, senha: SENHA })).status, 403);
});

test('reativar devolve o acesso', async () => {
  const admin = await comoAdmin();
  await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'INATIVO' });
  await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'ATIVO' });

  assert.equal((await request(app).post('/api/auth/login').send({ email: ESTUDANTE.email, senha: SENHA })).status, 200);
});

test('nenhuma rota do módulo apaga registros fisicamente', async () => {
  const admin = await comoAdmin();
  const { rows: antes } = await query('SELECT count(*)::int AS total FROM usuario');

  // DELETE não está implementado em nenhuma das rotas.
  assert.equal((await admin.delete(`/api/usuarios/${idEstudante}`)).status, 404);
  await admin.patch(`/api/usuarios/${idEstudante}/situacao`).send({ situacao: 'INATIVO' });

  const { rows: depois } = await query('SELECT count(*)::int AS total FROM usuario');
  assert.equal(depois[0].total, antes[0].total);
});

// ------------------------------------------------- proteção contra travar o sistema

test('administrador não pode inativar a própria conta', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.patch(`/api/usuarios/${idAdmin}/situacao`).send({ situacao: 'INATIVO' });

  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /própria conta/i);
  assert.equal((await admin.get('/api/auth/eu')).status, 200, 'a sessão deve continuar de pé');
});

test('administrador não pode alterar o próprio perfil', async () => {
  const admin = await comoAdmin();
  const resposta = await admin.patch(`/api/usuarios/${idAdmin}`).send({ perfil: 'PROFESSOR' });

  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /próprio perfil/i);
});

test('o sistema nunca fica sem administrador ativo', async () => {
  // Invariante: quem opera estas rotas é um administrador ATIVO e não pode mexer na
  // própria conta. Logo, mesmo derrubando todos os outros, ele próprio sobra.
  const admin = await comoAdmin();

  const { rows: outros } = await query(
    "SELECT id FROM usuario WHERE perfil = 'ADMINISTRADOR' AND id <> $1",
    [idAdmin],
  );
  assert.ok(outros.length >= 1, 'o cenário exige ao menos outro administrador (o do seed)');

  // Rebaixar e inativar todos os demais administradores é permitido.
  for (const { id } of outros) {
    assert.equal((await admin.patch(`/api/usuarios/${id}`).send({ perfil: 'PROFESSOR' })).status, 200);
    assert.equal((await admin.patch(`/api/usuarios/${id}/situacao`).send({ situacao: 'INATIVO' })).status, 200);
  }

  // Restou exatamente um administrador ativo: o próprio autor das ações.
  const { rows: ativos } = await query(
    "SELECT id FROM usuario WHERE perfil = 'ADMINISTRADOR' AND situacao = 'ATIVO'",
  );
  assert.deepEqual(ativos.map((u) => u.id), [idAdmin]);

  // E ele não consegue eliminar a si mesmo por nenhum dos dois caminhos.
  assert.equal((await admin.patch(`/api/usuarios/${idAdmin}/situacao`).send({ situacao: 'INATIVO' })).status, 409);
  assert.equal((await admin.patch(`/api/usuarios/${idAdmin}`).send({ perfil: 'PROFESSOR' })).status, 409);

  const { rows: aindaAtivos } = await query(
    "SELECT count(*)::int AS total FROM usuario WHERE perfil = 'ADMINISTRADOR' AND situacao = 'ATIVO'",
  );
  assert.equal(aindaAtivos[0].total, 1);
});

test('rebaixar outro administrador é permitido', async () => {
  const admin = await comoAdmin();
  const { rows } = await query(
    "SELECT id FROM usuario WHERE perfil = 'ADMINISTRADOR' AND situacao = 'ATIVO' AND id <> $1 LIMIT 1",
    [idAdmin],
  );
  assert.ok(rows[0], 'o cenário exige dois administradores ativos');

  const resposta = await admin.patch(`/api/usuarios/${rows[0].id}`).send({ perfil: 'PROFESSOR' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.perfil, 'PROFESSOR');
});

// ----------------------------------------------------------------- próprios dados (UC03)

test('qualquer usuário autenticado consulta e edita os próprios dados', async () => {
  const estudante = await comoEstudante();

  const consulta = await estudante.get('/api/usuarios/eu');
  assert.equal(consulta.status, 200);
  assert.equal(consulta.body.usuario.email, ESTUDANTE.email);

  const edicao = await estudante.patch('/api/usuarios/eu').send({ nome: 'Meu Nome Novo' });
  assert.equal(edicao.status, 200);
  assert.equal(edicao.body.usuario.nome, 'Meu Nome Novo');
});

test('editar os próprios dados não permite trocar de perfil nem de situação', async () => {
  const estudante = await comoEstudante();

  const resposta = await estudante
    .patch('/api/usuarios/eu')
    .send({ nome: 'Tentativa', perfil: 'ADMINISTRADOR', situacao: 'INATIVO' });

  assert.equal(resposta.status, 200);
  assert.equal(resposta.body.usuario.perfil, 'ESTUDANTE');
  assert.equal(resposta.body.usuario.situacao, 'ATIVO');

  const { rows } = await query('SELECT perfil, situacao FROM usuario WHERE id = $1', [idEstudante]);
  assert.equal(rows[0].perfil, 'ESTUDANTE');
  assert.equal(rows[0].situacao, 'ATIVO');

  assert.equal((await estudante.get('/api/painel/administrador')).status, 403);
});

test('"/eu" não é confundido com um id de usuário', async () => {
  // Sem sessão a rota exige login, em vez de tentar buscar o usuário de id "eu".
  const resposta = await request(app).get('/api/usuarios/eu');
  assert.equal(resposta.status, 401);
});

test('trocar os próprios dados para um e-mail já usado devolve 409', async () => {
  const estudante = await comoEstudante();
  const resposta = await estudante.patch('/api/usuarios/eu').send({ email: PROFESSOR.email });

  assert.equal(resposta.status, 409);
  assert.ok(resposta.body.campos.email);
});

// ------------------------------------------------------------- troca da própria senha

test('usuário troca a própria senha informando a senha atual', async () => {
  const estudante = await comoEstudante();
  const nova = 'minha-senha-nova-1';

  const troca = await estudante.put('/api/usuarios/eu/senha').send({ senhaAtual: SENHA, novaSenha: nova });
  assert.equal(troca.status, 200);

  assert.equal((await request(app).post('/api/auth/login').send({ email: ESTUDANTE.email, senha: SENHA })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: ESTUDANTE.email, senha: nova })).status, 200);
});

test('a troca de senha exige a senha atual correta', async () => {
  const estudante = await comoEstudante();
  const resposta = await estudante
    .put('/api/usuarios/eu/senha')
    .send({ senhaAtual: 'nao-e-a-minha', novaSenha: 'minha-senha-nova-1' });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.senhaAtual);

  // A senha original continua valendo.
  assert.equal((await request(app).post('/api/auth/login').send({ email: ESTUDANTE.email, senha: SENHA })).status, 200);
});

test('a nova senha precisa ter pelo menos 8 caracteres', async () => {
  const estudante = await comoEstudante();
  const resposta = await estudante.put('/api/usuarios/eu/senha').send({ senhaAtual: SENHA, novaSenha: 'curta' });

  assert.equal(resposta.status, 400);
  assert.ok(resposta.body.campos.novaSenha);
});

test('trocar a própria senha invalida links de redefinição pendentes', async () => {
  // Pede um link e, antes de usá-lo, troca a senha pelo caminho normal.
  const { solicitarRedefinicao } = await import('../src/modules/auth/auth.service.js');
  const { linkDesenvolvimento } = await solicitarRedefinicao({ email: ESTUDANTE.email });
  const token = new URL(linkDesenvolvimento).searchParams.get('token');

  const estudante = await comoEstudante();
  await estudante.put('/api/usuarios/eu/senha').send({ senhaAtual: SENHA, novaSenha: 'minha-senha-nova-1' });

  const resposta = await request(app).post('/api/auth/redefinicao').send({ token, senha: 'outra-senha-999' });
  assert.equal(resposta.status, 400);
});

test('a troca de senha exige estar autenticado', async () => {
  const resposta = await request(app)
    .put('/api/usuarios/eu/senha')
    .send({ senhaAtual: SENHA, novaSenha: 'minha-senha-nova-1' });

  assert.equal(resposta.status, 401);
});

// ----------------------------------------------------------------------- rate limiting

test('autocadastros em excesso a partir do mesmo endereço são bloqueados', async () => {
  const restrito = criarApp({ limites: { cadastroMax: 2, janelaMinutos: 15 } });

  for (let i = 0; i < 2; i += 1) {
    const resposta = await request(restrito)
      .post('/api/usuarios/cadastro')
      .send({ nome: `Aluno ${i}`, email: `aluno${i}@exemplo.com`, senha: 'senha-nova-123' });
    assert.equal(resposta.status, 201);
  }

  const bloqueado = await request(restrito)
    .post('/api/usuarios/cadastro')
    .send({ nome: 'Aluno 3', email: 'aluno3@exemplo.com', senha: 'senha-nova-123' });

  assert.equal(bloqueado.status, 429);
});
