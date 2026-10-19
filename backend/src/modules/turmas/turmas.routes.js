// RF06 — rotas de turmas (UC06).
//
//   /api/turmas            → professor administra as próprias turmas
//   /api/estudante/turmas  → estudante entra por código e consulta as suas
//
// Não existe DELETE: turma é inativada (Quadro 31) e decisões sobre estudantes só mudam
// a situação do vínculo.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import {
  alterarSituacao,
  atualizar,
  criar,
  decidir,
  detalhar,
  detalharParaEstudante,
  entrarComCodigo,
  sairDaTurma,
  gerarNovoCodigo,
  listar,
  removerEstudante,
  turmasDoEstudante,
} from './turmas.service.js';

const esquemaTurma = z.object({
  nome: z
    .string({ error: 'Informe o nome da turma.' })
    .trim()
    .min(1, 'Informe o nome da turma.')
    .max(120, 'O nome deve ter no máximo 120 caracteres.'),
  descricao: z
    .string()
    .trim()
    .max(2000, 'A descrição deve ter no máximo 2000 caracteres.')
    .nullish()
    .transform((v) => v || null),
  // P-09: entrada direta pelo código (padrão) ou com aprovação do professor.
  requerAprovacao: z.boolean({ error: 'Indique como os estudantes entram na turma.' }).optional().default(false),
});

const esquemaListagem = z.object({
  busca: z.string().max(120).optional().default(''),
  situacao: z.enum(['ATIVA', 'INATIVA', 'TODAS']).optional().default('ATIVA'),
});

const esquemaSituacao = z.object({ situacao: z.enum(['ATIVA', 'INATIVA'], { error: 'Situação inválida.' }) });
const esquemaCodigo = z.object({
  codigo: z.string({ error: 'Informe o código da turma.' }).trim().min(1, 'Informe o código da turma.').max(40),
});
const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

// ------------------------------------------------------------------------ professor
export const rotasTurmas = Router();
rotasTurmas.use(autenticar, autorizar('PROFESSOR'));

rotasTurmas.get('/', async (req, res) => {
  res.json(await listar(req.usuario.id, validar(esquemaListagem, req.query)));
});

rotasTurmas.post('/', async (req, res) => {
  res.status(201).json({ turma: await criar(req.usuario.id, validar(esquemaTurma, req.body)) });
});

rotasTurmas.get('/:id', async (req, res) => {
  res.json({ turma: await detalhar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasTurmas.put('/:id', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  res.json({ turma: await atualizar(id, req.usuario.id, validar(esquemaTurma, req.body)) });
});

rotasTurmas.post('/:id/codigo', async (req, res) => {
  res.json({ turma: await gerarNovoCodigo(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasTurmas.patch('/:id/situacao', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { situacao } = validar(esquemaSituacao, req.body);
  res.json({ turma: await alterarSituacao(id, req.usuario.id, situacao) });
});

// UC06 A3 / A4
for (const [acao, decisao] of [['aprovar', 'APROVADA'], ['recusar', 'RECUSADA']]) {
  rotasTurmas.post(`/:id/solicitacoes/:estudanteId/${acao}`, async (req, res) => {
    const id = validar(esquemaId, req.params.id);
    const estudanteId = validar(esquemaId, req.params.estudanteId);
    res.json({ turma: await decidir(id, req.usuario.id, estudanteId, decisao) });
  });
}

// O professor remove um estudante da turma.
//
// POST, e não DELETE: nada é apagado. O vínculo permanece com `situacao = 'SAIU'` e o
// registro de quem removeu — as provas que o estudante fez são histórico da turma.
rotasTurmas.post('/:id/estudantes/:estudanteId/remover', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const estudanteId = validar(esquemaId, req.params.estudanteId);
  res.json(await removerEstudante(id, estudanteId, req.usuario.id));
});

// ------------------------------------------------------------------------ estudante
export function criarRotasTurmasDoEstudante(opcoes = {}) {
  const limites = { ...env.limites, ...opcoes.limites };
  const rotas = Router();
  rotas.use(autenticar, autorizar('ESTUDANTE'));

  const limitarCodigo = rateLimit({
    windowMs: limites.janelaMinutos * 60 * 1000,
    limit: limites.codigoTurmaMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { trustProxy: false },
    handler: (req, res) =>
      res.status(429).json({ erro: 'Muitas tentativas de código. Aguarde alguns minutos e tente novamente.' }),
  });

  rotas.get('/', async (req, res) => {
    res.json(await turmasDoEstudante(req.usuario.id));
  });

  // A turma por dentro: dados da turma e as avaliações vinculadas a ela (RF07, RF08).
  rotas.get('/:id', async (req, res) => {
    res.json(await detalharParaEstudante(validar(esquemaId, req.params.id), req.usuario.id));
  });

  // UC06 A2 (entrada direta) ou A3 (solicitação), conforme a turma.
  rotas.post('/entrar', limitarCodigo, async (req, res) => {
    const { codigo } = validar(esquemaCodigo, req.body);
    res.status(201).json(await entrarComCodigo(req.usuario.id, codigo));
  });

  // P-24 — cancelar a própria inscrição. POST, e não DELETE: nada é apagado, o vínculo
  // passa a constar como encerrado.
  rotas.post('/:id/sair', async (req, res) => {
    res.json(await sairDaTurma(validar(esquemaId, req.params.id), req.usuario.id));
  });

  return rotas;
}
