// RF11 (parcial) — rotas de correção (UC11), exclusivas do professor dono da avaliação.
//
// Estas rotas mostram o gabarito e a resposta esperada: são do professor. O estudante
// só verá a nota depois da liberação (P-07), e a consulta detalhada é da Etapa 8 (RF13).
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import {
  corrigirDiscursivas,
  detalharTentativa,
  liberarResultados,
  listarTentativas,
  reabrirProva,
  reabrirTentativa,
  sugerirNotaDaResposta,
  sugerirNotasPendentes,
} from './correcao.service.js';
import { estadoDaIA } from '../../servicos/ia/ia.service.js';

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

// Reabrir pede os dois: quanto tempo e por quê. O motivo é obrigatório de propósito —
// o sistema permite a exceção, mas não deixa que ela seja silenciosa. É o que o professor
// terá para mostrar se alguém perguntar por que aquela prova foi devolvida.
const esquemaReabertura = z.object({
  minutos: z.coerce
    .number({ error: 'Informe quantos minutos.' })
    .int('Use minutos inteiros.')
    .positive('O tempo deve ser maior que zero.')
    .max(600, 'No máximo 600 minutos.'),
  motivo: z
    .string({ error: 'Informe o motivo.' })
    .trim()
    .min(3, 'Explique o motivo em poucas palavras.')
    .max(500, 'O motivo é longo demais.'),
});

const esquemaCorrecao = z.object({
  correcoes: z
    .array(
      z.object({
        questaoId: z.coerce.number({ error: 'Questão inválida.' }).int().positive('Questão inválida.'),
        // A nota da discursiva é do professor (RN04): sem valor não há correção.
        nota: z.coerce
          .number({ error: 'Informe a nota.' })
          .min(0, 'A nota não pode ser negativa.')
          .max(1000, 'Nota inválida.')
          .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'Use no máximo duas casas decimais.'),
        feedback: z.string().max(5000, 'O feedback é longo demais.').nullish(),
      }),
      { error: 'Envie as correções.' },
    )
    .min(1, 'Envie ao menos uma correção.')
    .max(200)
    .refine((lista) => new Set(lista.map((c) => c.questaoId)).size === lista.length, 'A mesma questão aparece duas vezes.'),
});

export const rotasCorrecao = Router();
rotasCorrecao.use(autenticar, autorizar('PROFESSOR'));

// Painel de correção: quem fez a prova, o que já está corrigido e o que falta.
rotasCorrecao.get('/:avaliacaoId', async (req, res) => {
  res.json(await listarTentativas(validar(esquemaId, req.params.avaliacaoId), req.usuario.id));
});

// Uma prova: respostas do estudante, gabarito das objetivas e referência das discursivas.
rotasCorrecao.get('/:avaliacaoId/tentativas/:tentativaId', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.tentativaId);
  res.json(await detalharTentativa(avaliacaoId, req.usuario.id, tentativaId));
});

// Grava nota e feedback das discursivas (P-08).
rotasCorrecao.put('/:avaliacaoId/tentativas/:tentativaId', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.tentativaId);
  const { correcoes } = validar(esquemaCorrecao, req.body);
  res.json(await corrigirDiscursivas(avaliacaoId, req.usuario.id, tentativaId, correcoes));
});

// P-07: ação explícita para os estudantes passarem a ver a nota.
// RF11 / UC11 — o professor pede auxílio da IA para uma questão discursiva.
//
// POST porque a chamada tem efeito: consulta o serviço externo (que custa) e grava a
// sugestão na resposta. A nota final NÃO é alterada aqui (RN04).
rotasCorrecao.post('/:avaliacaoId/tentativas/:tentativaId/questoes/:questaoId/sugestao', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.tentativaId);
  const questaoId = validar(esquemaId, req.params.questaoId);
  res.json(await sugerirNotaDaResposta(avaliacaoId, tentativaId, questaoId, req.usuario.id));
});

// POST /api/correcao/:avaliacaoId/tentativas/:id/sugestoes — analisa de uma vez todas as
// discursivas ainda sem sugestão. É o que a tela de correção chama ao abrir a prova.
rotasCorrecao.post('/:avaliacaoId/tentativas/:tentativaId/sugestoes', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.tentativaId);
  res.json(await sugerirNotasPendentes(avaliacaoId, tentativaId, req.usuario.id));
});

// GET /api/correcao/ia — com que configuração a tela está trabalhando (real ou simulada).
rotasCorrecao.get('/ia/estado', (req, res) => {
  res.json(estadoDaIA());
});

// Devolver a prova a UM estudante: computador travado, bloqueio injusto, falta de luz
// que atingiu só ele. A prova volta a ficar em andamento, com prazo novo.
rotasCorrecao.post('/:avaliacaoId/tentativas/:tentativaId/reabrir', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.tentativaId);
  const dados = validar(esquemaReabertura, req.body);
  res.json(await reabrirTentativa(avaliacaoId, tentativaId, req.usuario.id, dados));
});

// Devolver a TODOS: a queda de energia da sala inteira. Mesma operação, em lote.
rotasCorrecao.post('/:avaliacaoId/reabrir', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const dados = validar(esquemaReabertura, req.body);
  res.json(await reabrirProva(avaliacaoId, req.usuario.id, dados));
});

rotasCorrecao.post('/:avaliacaoId/liberar', async (req, res) => {
  res.json(await liberarResultados(validar(esquemaId, req.params.avaliacaoId), req.usuario.id));
});
