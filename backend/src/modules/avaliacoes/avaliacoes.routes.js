// RF03 e RF04 — rotas de avaliações (UC03, UC04). Exclusivas do professor (RN02).
//
// Não existe DELETE: "excluir" é uma ação (POST /:id/excluir) que muda o status para
// EXCLUIDA, preservando a linha (Quadro 31, DT14).
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import {
  arquivar,
  criar,
  definirDivulgacao,
  definirQuestoes,
  editarQuestaoDaProva,
  detalhar,
  duplicar,
  excluir,
  listar,
  publicar,
  atualizar,
  prepararTeste,
  corrigirTeste,
  vincularTurmas,
} from './avaliacoes.service.js';
import { esquemaQuestao } from '../questoes/questoes.routes.js';

const DURACAO_MAXIMA = 24 * 60; // um dia; acima disso não é mais uma "prova"
const MAX_QUESTOES = 200;

const dataHora = (mensagem) =>
  z
    .string({ error: mensagem })
    .min(1, mensagem)
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data e hora inválidas.')
    .transform((v) => new Date(v));

const pontuacao = z.coerce
  .number({ error: 'Pontuação inválida.' })
  .positive('A pontuação deve ser maior que zero.')
  .max(1000, 'A pontuação deve ser no máximo 1000.')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'Use no máximo duas casas decimais.');

// O que o estudante vê, além da nota, quando os resultados forem liberados (RF13
// estendido). Cada opção é um sim/não; o que não vier fica como não — o padrão é nada
// além da nota.
//
// Fica aqui em cima porque a CRIAÇÃO também o usa: o professor decide a visibilidade
// junto com o resto da prova, e não depois, numa tela que ele só abriria por acaso.
const esquemaDivulgacao = z.object({
  gabarito: z.boolean().optional().default(false),
  mediaTurma: z.boolean().optional().default(false),
  distribuicao: z.boolean().optional().default(false),
  questoesDestaque: z.boolean().optional().default(false),
});

// UC03 A1: cada campo obrigatório vazio volta com mensagem própria em `campos`.
const esquemaAvaliacao = z
  .object({
    titulo: z
      .string({ error: 'Informe o título.' })
      .trim()
      .min(1, 'Informe o título.')
      .max(200, 'O título deve ter no máximo 200 caracteres.'),
    descricao: z
      .string()
      .trim()
      .max(5000, 'As instruções devem ter no máximo 5000 caracteres.')
      .nullish()
      .transform((v) => v || null),
    // Campo vazio vira "ausente" antes da conversão: sem isso, "" viraria 0 e a mensagem
    // seria "maior que zero" em vez de apontar o campo pendente (UC03 A1).
    duracaoMinutos: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.coerce
        .number({ error: 'Informe a duração.' })
        .int('A duração deve ser em minutos inteiros.')
        .positive('A duração deve ser maior que zero.')
        .max(DURACAO_MAXIMA, `A duração deve ser de no máximo ${DURACAO_MAXIMA} minutos.`),
    ),
    dataInicio: dataHora('Informe o início do período.'),
    dataFim: dataHora('Informe o término do período.'),
    monitoramentoAtivo: z.boolean({ error: 'Indique se o monitoramento fica ativo.' }).optional().default(true),
    // P-06: vazio = registra as ocorrências, mas nunca bloqueia a tentativa.
    // `.optional()` é necessário: o campo pode simplesmente não vir no corpo.
    limiteOcorrencias: z
      .any()
      .optional()
      .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)))
      .refine(
        (v) => v === null || (Number.isInteger(v) && v > 0 && v <= 100),
        'Informe um número inteiro entre 1 e 100, ou deixe em branco.',
      ),
    // Opcional, e sem `default`: ausente significa "não mexa nisso". Um `default` aqui
    // faria um PUT que só troca o título desmarcar em silêncio tudo o que o professor
    // já tinha escolhido.
    divulgacao: esquemaDivulgacao.optional(),
  })
  .superRefine((a, ctx) => {
    if (a.dataFim <= a.dataInicio) {
      ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'O término deve ser depois do início.' });
      return;
    }
    // P-05 / DT06: o prazo real é min(início da tentativa + duração, término). Uma
    // duração maior que o período inteiro nunca poderia ser cumprida.
    const janelaMinutos = (a.dataFim - a.dataInicio) / 60000;
    if (a.duracaoMinutos > janelaMinutos) {
      ctx.addIssue({
        code: 'custom',
        path: ['duracaoMinutos'],
        message: 'A duração não pode ser maior que o período em que a avaliação fica disponível.',
      });
    }
    // P-06: sem monitoramento não há ocorrências a contar, então não há o que bloquear.
    if (!a.monitoramentoAtivo && a.limiteOcorrencias !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['limiteOcorrencias'],
        message: 'O limite de ocorrências só vale com o monitoramento ativo.',
      });
    }
  });

const esquemaQuestoes = z.object({
  questoes: z
    .array(
      z.object({
        questaoId: z.coerce.number({ error: 'Questão inválida.' }).int().positive('Questão inválida.'),
        pontuacao: pontuacao.optional(),
      }),
      { error: 'Envie a lista de questões.' },
    )
    .max(MAX_QUESTOES, `Uma avaliação pode ter no máximo ${MAX_QUESTOES} questões.`)
    .refine((lista) => new Set(lista.map((q) => q.questaoId)).size === lista.length, 'A mesma questão aparece mais de uma vez.'),
});

const esquemaListagem = z.object({
  busca: z.string().max(200).optional().default(''),
  situacao: z.enum(['ATIVAS', 'RASCUNHO', 'PUBLICADA', 'ARQUIVADA']).optional().default('ATIVAS'),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  tamanho: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

// UC07 A1: nenhuma turma selecionada → "pelo menos uma turma deve ser selecionada".
const esquemaVinculo = z.object({
  turmaIds: z
    .array(z.coerce.number({ error: 'Turma inválida.' }).int().positive('Turma inválida.'), {
      error: 'Selecione pelo menos uma turma.',
    })
    .min(1, 'Selecione pelo menos uma turma.')
    .max(100, 'Selecione no máximo 100 turmas por vez.')
    .refine((lista) => new Set(lista).size === lista.length, 'A mesma turma foi selecionada duas vezes.'),
});

const esquemaRespostasTeste = z.object({
  respostas: z
    .array(
      z.object({
        questaoId: z.coerce.number({ error: 'Questão inválida.' }).int().positive('Questão inválida.'),
        alternativaId: z.coerce.number({ error: 'Alternativa inválida.' }).int().positive().nullish(),
        texto: z.string().max(20000, 'A resposta é longa demais.').nullish(),
      }),
      { error: 'Envie a lista de respostas.' },
    )
    .max(MAX_QUESTOES)
    .refine((lista) => new Set(lista.map((r) => r.questaoId)).size === lista.length, 'A mesma questão foi respondida duas vezes.'),
});

export const rotasAvaliacoes = Router();

// RN02: somente professores criam, editam, publicam ou excluem avaliações.
rotasAvaliacoes.use(autenticar, autorizar('PROFESSOR'));

rotasAvaliacoes.get('/', async (req, res) => {
  res.json(await listar(req.usuario.id, validar(esquemaListagem, req.query)));
});

rotasAvaliacoes.post('/', async (req, res) => {
  const dados = validar(esquemaAvaliacao, req.body);
  res.status(201).json({ avaliacao: await criar(req.usuario.id, dados) });
});

rotasAvaliacoes.get('/:id', async (req, res) => {
  res.json({ avaliacao: await detalhar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasAvaliacoes.put('/:id', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const dados = validar(esquemaAvaliacao, req.body);
  res.json({ avaliacao: await atualizar(id, req.usuario.id, dados) });
});

rotasAvaliacoes.put('/:id/questoes', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { questoes } = validar(esquemaQuestoes, req.body);
  res.json({ avaliacao: await definirQuestoes(id, req.usuario.id, questoes) });
});

// RF13 estendido: o que o estudante vê quando os resultados forem liberados.
// Editar uma questão pela tela da prova. Se ela vier do banco, o banco NÃO muda: a prova
// recebe uma cópia com as alterações (ver `editarQuestaoDaProva`).
rotasAvaliacoes.put('/:id/questoes/:questaoId', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const questaoId = validar(esquemaId, req.params.questaoId);
  const dados = validar(esquemaQuestao, req.body);
  res.json({ avaliacao: await editarQuestaoDaProva(id, questaoId, req.usuario.id, dados) });
});

rotasAvaliacoes.put('/:id/divulgacao', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const opcoes = validar(esquemaDivulgacao, req.body);
  res.json({ avaliacao: await definirDivulgacao(id, req.usuario.id, opcoes) });
});

rotasAvaliacoes.post('/:id/publicar', async (req, res) => {
  res.json({ avaliacao: await publicar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasAvaliacoes.post('/:id/arquivar', async (req, res) => {
  res.json({ avaliacao: await arquivar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasAvaliacoes.post('/:id/duplicar', async (req, res) => {
  res.status(201).json({ avaliacao: await duplicar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasAvaliacoes.post('/:id/excluir', async (req, res) => {
  res.json(await excluir(validar(esquemaId, req.params.id), req.usuario.id));
});

// RF07 / UC07 — a turma da avaliação. Vincular e TROCAR, nao ha retirar: sem turma a
// prova nao aparece em lista nenhuma, e retirar seria esconde-la sem avisar ninguem.
rotasAvaliacoes.post('/:id/turmas', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { turmaIds } = validar(esquemaVinculo, req.body);
  res.json(await vincularTurmas(id, req.usuario.id, turmaIds));
});

// Modo de teste do professor (P-20). Somente leitura no banco: nada é gravado.
rotasAvaliacoes.get('/:id/teste', async (req, res) => {
  res.json({ avaliacao: await prepararTeste(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasAvaliacoes.post('/:id/teste/correcao', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { respostas } = validar(esquemaRespostasTeste, req.body);
  res.json(await corrigirTeste(id, req.usuario.id, respostas));
});
