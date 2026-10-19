// RF02 — rotas de usuários e perfis (UC02, UC03).
//
// A ordem importa: `/cadastro` e `/eu` são declaradas ANTES de `/:id`, senão o Express
// trataria "eu" como um id.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z, esquemaEmail, esquemaSenha } from '../../utils/validacao.js';
import {
  PERFIS,
  alterarPropriaSenha,
  alterarSituacao,
  atualizar,
  atualizarPropriosDados,
  autocadastrar,
  buscarPorId,
  criar,
  listar,
} from './usuarios.service.js';

const esquemaNome = z
  .string({ error: 'Informe o nome.' })
  .trim()
  .min(2, 'O nome deve ter pelo menos 2 caracteres.')
  .max(120, 'O nome é longo demais.');

const esquemaCadastroPublico = z.object({
  nome: esquemaNome,
  email: esquemaEmail,
  senha: esquemaSenha,
  // Dois perfis, e ADMINISTRADOR fora da lista de propósito: a rota é pública, e um
  // enum aberto aqui seria escalonamento de privilégio por corpo de requisição.
  // O serviço repete a verificação — defesa em profundidade, não excesso de zelo.
  perfil: z
    .enum(['ESTUDANTE', 'PROFESSOR'], { error: 'Escolha se você é estudante ou professor.' })
    .optional()
    .default('ESTUDANTE'),
});

const esquemaCriacao = z.object({
  nome: esquemaNome,
  email: esquemaEmail,
  senha: esquemaSenha,
  perfil: z.enum(PERFIS, { error: 'Escolha um perfil válido.' }),
  situacao: z.enum(['ATIVO', 'INATIVO'], { error: 'Situação inválida.' }).optional(),
});

// Edição parcial: só os campos enviados mudam, mas ao menos um precisa vir.
const esquemaEdicao = z
  .object({
    nome: esquemaNome.optional(),
    email: esquemaEmail.optional(),
    perfil: z.enum(PERFIS, { error: 'Escolha um perfil válido.' }).optional(),
  })
  .refine((dados) => Object.keys(dados).length > 0, { message: 'Informe ao menos um campo para alterar.' });

const esquemaPropriosDados = z
  .object({ nome: esquemaNome.optional(), email: esquemaEmail.optional() })
  .refine((dados) => Object.keys(dados).length > 0, { message: 'Informe ao menos um campo para alterar.' });

const esquemaSituacao = z.object({
  situacao: z.enum(['ATIVO', 'INATIVO'], { error: 'Situação inválida.' }),
});

const esquemaTrocaDeSenha = z.object({
  senhaAtual: z.string({ error: 'Informe a senha atual.' }).min(1, 'Informe a senha atual.'),
  novaSenha: esquemaSenha,
});

const esquemaListagem = z.object({
  busca: z.string().max(120).optional().default(''),
  perfil: z.enum(PERFIS).optional(),
  situacao: z.enum(['ATIVO', 'INATIVO']).optional(),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  tamanho: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

export function criarRotasUsuarios(opcoes = {}) {
  const limites = { ...env.limites, ...opcoes.limites };
  const rotas = Router();

  // O autocadastro cria contas: sem limite, viraria ferramenta de poluição do banco.
  const limitarCadastro = rateLimit({
    windowMs: limites.janelaMinutos * 60 * 1000,
    limit: limites.cadastroMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { trustProxy: false },
    handler: (req, res) =>
      res.status(429).json({ erro: 'Muitos cadastros a partir deste endereço. Aguarde alguns minutos.' }),
  });

  // ------------------------------------------------------------------ autocadastro (UC03)
  // Rota pública. O corpo aceita o perfil, mas só entre estudante e professor: mesmo que
  // o cliente envie "perfil": "ADMINISTRADOR", a validação recusa e o serviço cria um
  // ESTUDANTE. Administrador continua nascendo só pelo seed ou por outro administrador.
  rotas.post('/cadastro', limitarCadastro, async (req, res) => {
    const dados = validar(esquemaCadastroPublico, req.body);
    res.status(201).json({ usuario: await autocadastrar(dados) });
  });

  // -------------------------------------------------------------- próprios dados (UC03)
  rotas.get('/eu', autenticar, async (req, res) => {
    res.json({ usuario: await buscarPorId(req.usuario.id) });
  });

  rotas.patch('/eu', autenticar, async (req, res) => {
    const dados = validar(esquemaPropriosDados, req.body);
    res.json({ usuario: await atualizarPropriosDados(req.usuario.id, dados) });
  });

  rotas.put('/eu/senha', autenticar, async (req, res) => {
    const dados = validar(esquemaTrocaDeSenha, req.body);
    await alterarPropriaSenha(req.usuario.id, dados);
    res.json({ mensagem: 'Senha alterada.' });
  });

  // ------------------------------------------------------- administração de contas (UC02)
  const somenteAdmin = [autenticar, autorizar('ADMINISTRADOR')];

  rotas.get('/', somenteAdmin, async (req, res) => {
    res.json(await listar(validar(esquemaListagem, req.query)));
  });

  rotas.post('/', somenteAdmin, async (req, res) => {
    const dados = validar(esquemaCriacao, req.body);
    res.status(201).json({ usuario: await criar(dados) });
  });

  rotas.get('/:id', somenteAdmin, async (req, res) => {
    res.json({ usuario: await buscarPorId(validar(esquemaId, req.params.id)) });
  });

  rotas.patch('/:id', somenteAdmin, async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    const dados = validar(esquemaEdicao, req.body);
    res.json({ usuario: await atualizar(id, dados, req.usuario) });
  });

  rotas.patch('/:id/situacao', somenteAdmin, async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    const { situacao } = validar(esquemaSituacao, req.body);
    res.json({ usuario: await alterarSituacao(id, situacao, req.usuario) });
  });

  return rotas;
}
