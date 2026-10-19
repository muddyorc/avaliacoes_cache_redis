// RF05 — rotas do banco de questões (UC05). Exclusivas do professor (Quadro 31).
//
// Estas rotas devolvem o gabarito (alternativa correta, resposta esperada, critérios)
// porque só o DONO da questão as acessa. O estudante lê questões apenas ao realizar uma
// avaliação (Etapa 6), por rotas próprias que jamais incluem esses campos (DT13, RNF17).
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import {
  alterarSituacao,
  atualizar,
  criar,
  detalhar,
  duplicar,
  listar,
  listarTemas,
  promoverAoBanco,
} from './questoes.service.js';

const MIN_ALTERNATIVAS = 2; // V/F = 2 alternativas (P-03)
const MAX_ALTERNATIVAS = 10;

const textoOpcional = (maximo, mensagem) =>
  z
    .string()
    .trim()
    .max(maximo, mensagem)
    .nullish()
    .transform((valor) => valor || null);

// Exportado para a rota que edita uma questão DENTRO da avaliação: é o mesmo formato, e
// duas cópias do esquema divergiriam na primeira regra nova.
export const esquemaQuestao = z
  .object({
    tipo: z.enum(['OBJETIVA', 'DISCURSIVA'], { error: 'Escolha o tipo da questão.' }),
    enunciado: z
      .string({ error: 'Informe o enunciado.' })
      .trim()
      .min(1, 'Informe o enunciado.')
      .max(10000, 'O enunciado é longo demais.'),
    tema: textoOpcional(100, 'O tema deve ter no máximo 100 caracteres.'),
    pontuacaoPadrao: z.coerce
      .number({ error: 'Informe a pontuação.' })
      .positive('A pontuação deve ser maior que zero.')
      .max(1000, 'A pontuação deve ser no máximo 1000.')
      // NUMERIC(6,2) no banco: mais de 2 casas seria arredondado em silêncio.
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'Use no máximo duas casas decimais.'),
    alternativas: z
      .array(
        z.object({
          texto: z
            .string({ error: 'Informe o texto da alternativa.' })
            .trim()
            .min(1, 'Informe o texto da alternativa.')
            .max(2000, 'O texto da alternativa é longo demais.'),
          correta: z.boolean().optional().default(false),
        }),
        { error: 'Alternativas inválidas.' },
      )
      .optional()
      .default([]),
    // P-26: objetiva em que mais de uma alternativa pode ser correta. O padrão continua
    // sendo resposta única — quem não manda o campo cria a questao de sempre.
    multiplasCorretas: z.boolean().optional().default(false),
    respostaEsperada: textoOpcional(10000, 'A resposta esperada é longa demais.'),
    criteriosCorrecao: textoOpcional(10000, 'Os critérios são longos demais.'),
  })
  .superRefine((q, ctx) => {
    if (q.tipo === 'OBJETIVA') {
      if (q.alternativas.length < MIN_ALTERNATIVAS) {
        ctx.addIssue({
          code: 'custom',
          path: ['alternativas'],
          message: `Uma questão objetiva precisa de pelo menos ${MIN_ALTERNATIVAS} alternativas.`,
        });
      } else if (q.alternativas.length > MAX_ALTERNATIVAS) {
        ctx.addIssue({
          code: 'custom',
          path: ['alternativas'],
          message: `Uma questão objetiva pode ter no máximo ${MAX_ALTERNATIVAS} alternativas.`,
        });
      }

      // Toda objetiva precisa de pelo menos uma correta: sem gabarito não há correção
      // automática (UC11 A2 deixa de poder acontecer). Quantas são aceitas depende do
      // tipo de resposta (P-26).
      //
      // Esta verificação ficou mais importante do que era: até a migração 009, o banco
      // impedia duas corretas por índice parcial. A regra passou a depender de uma coluna
      // de outra tabela, que índice parcial não enxerga, e a garantia veio toda para cá
      // (DT82).
      const corretas = q.alternativas.filter((a) => a.correta).length;
      if (q.alternativas.length >= MIN_ALTERNATIVAS) {
        if (q.multiplasCorretas && corretas < 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['alternativas'],
            message: 'Marque pelo menos uma alternativa como correta.',
          });
        }
        if (!q.multiplasCorretas && corretas !== 1) {
          ctx.addIssue({
            code: 'custom',
            path: ['alternativas'],
            message: corretas > 1
              ? 'Esta questão aceita uma única correta. Para marcar mais de uma, ative "Mais de uma alternativa correta".'
              : 'Marque exatamente uma alternativa como correta.',
          });
        }
      }

      // Duas alternativas iguais tornariam a questão ambígua para o estudante.
      const textos = q.alternativas.map((a) => a.texto.toLowerCase());
      if (new Set(textos).size !== textos.length) {
        ctx.addIssue({ code: 'custom', path: ['alternativas'], message: 'Há alternativas com o mesmo texto.' });
      }
      // Discursiva. A resposta esperada é **opcional** (P-03 revista em 06/10/2026, a
      // pedido do autor): nem todo professor tem uma resposta-modelo pronta, e a correção
      // assistida avalia pelo enunciado, pelo tema e pelos critérios quando a referência
      // não existe. Quando existe, ela continua sendo a referência principal. Por isso
      // aqui só resta uma validação: discursiva não tem alternativas.
    } else if (q.multiplasCorretas) {
      ctx.addIssue({
        code: 'custom',
        path: ['multiplasCorretas'],
        message: 'Só questão objetiva tem alternativas corretas.',
      });
    } else if (q.alternativas.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['alternativas'],
        message: 'Questão discursiva não tem alternativas.',
      });
    }
  });

const esquemaListagem = z.object({
  busca: z.string().max(200).optional().default(''),
  tipo: z.enum(['OBJETIVA', 'DISCURSIVA']).optional(),
  tema: z.string().max(100).optional(),
  situacao: z.enum(['ATIVA', 'INATIVA', 'TODAS']).optional().default('ATIVA'),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  tamanho: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const esquemaSituacao = z.object({
  situacao: z.enum(['ATIVA', 'INATIVA'], { error: 'Situação inválida.' }),
});

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

export const rotasQuestoes = Router();

// Todo o módulo é do professor. Administrador e estudante recebem 403.
rotasQuestoes.use(autenticar, autorizar('PROFESSOR'));

// `/temas` antes de `/:id`, senão "temas" seria lido como identificador.
rotasQuestoes.get('/temas', async (req, res) => {
  res.json({ temas: await listarTemas(req.usuario.id) });
});

rotasQuestoes.get('/', async (req, res) => {
  res.json(await listar(req.usuario.id, validar(esquemaListagem, req.query)));
});

rotasQuestoes.post('/', async (req, res) => {
  const dados = validar(esquemaQuestao, req.body);
  // `noBanco: false` é o que a tela da avaliação envia: a questão nasce só para aquela
  // prova. Quem não diz nada cadastra no banco, que é o comportamento da tela do banco.
  const noBanco = req.body?.noBanco !== false;
  res.status(201).json({ questao: await criar(req.usuario.id, dados, { noBanco }) });
});

// Promove ao banco uma questão escrita dentro de uma prova (RF05).
rotasQuestoes.post('/:id/promover', async (req, res) => {
  res.json({ questao: await promoverAoBanco(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasQuestoes.get('/:id', async (req, res) => {
  res.json({ questao: await detalhar(validar(esquemaId, req.params.id), req.usuario.id) });
});

rotasQuestoes.put('/:id', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const dados = validar(esquemaQuestao, req.body);
  res.json({ questao: await atualizar(id, req.usuario.id, dados) });
});

rotasQuestoes.post('/:id/duplicar', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  res.status(201).json({ questao: await duplicar(id, req.usuario.id) });
});

rotasQuestoes.patch('/:id/situacao', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { situacao } = validar(esquemaSituacao, req.body);
  res.json({ questao: await alterarSituacao(id, req.usuario.id, situacao) });
});
