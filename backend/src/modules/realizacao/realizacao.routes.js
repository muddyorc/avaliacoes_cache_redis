// RF08 e RF09 — rotas da realização, em /api/estudante/avaliacoes.
//
// Exclusivas do estudante. Toda rota revalida no servidor se a avaliação está disponível
// para ele (RN05, P-19) e se o prazo ainda vale (DT06): a tela nunca é a autoridade.
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import { detalhar, finalizar, iniciar, listar, retomar, salvarRespostas } from './realizacao.service.js';
import { doEstudante } from './resultado.service.js';

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

const listaDeRespostas = z
  .array(
      z.object({
        questaoId: z.coerce.number({ error: 'Questão inválida.' }).int().positive('Questão inválida.'),
        alternativaId: z.coerce.number({ error: 'Alternativa inválida.' }).int().positive().nullish(),
        // P-26: as marcações da questão de múltipla escolha. Vazio significa “desmarquei
        // tudo”, que é resposta legítima e precisa chegar ao servidor.
        alternativaIds: z
          .array(z.coerce.number({ error: 'Alternativa inválida.' }).int().positive())
          .max(10, 'Marcações demais para uma questão.')
          .optional(),
        // Limite generoso: é uma resposta discursiva digitada durante a prova.
        texto: z.string().max(20000, 'A resposta é longa demais.').nullish(),
      }),
      { error: 'Envie a lista de respostas.' },
    )
  .max(200)
  .refine((lista) => new Set(lista.map((r) => r.questaoId)).size === lista.length, 'A mesma questão aparece duas vezes.');

const esquemaRespostas = z.object({ respostas: listaDeRespostas });
// Na entrega, mandar respostas é opcional: pode não haver nada pendente.
const esquemaFinalizar = z.object({ respostas: listaDeRespostas.optional().default([]) });

export const rotasRealizacao = Router();
rotasRealizacao.use(autenticar, autorizar('ESTUDANTE'));

// UC08, passos 2 e 3: as avaliações que o estudante pode realizar, com a situação de cada
// uma (inclui A1 "ainda não disponível" e A2 "período encerrado").
rotasRealizacao.get('/', async (req, res) => {
  res.json(await listar(req.usuario.id));
});

// UC08, passo 5: título, instruções, período e tempo, antes de iniciar.
rotasRealizacao.get('/:id', async (req, res) => {
  res.json({ avaliacao: await detalhar(validar(esquemaId, req.params.id), req.usuario.id) });
});

// UC08, passos 6 a 9: registra o início, calcula o prazo e devolve as questões.
// Se já houver tentativa em andamento, devolve o estado atual em vez de recomeçar (P-04).
rotasRealizacao.post('/:id/iniciar', async (req, res) => {
  res.json(await iniciar(validar(esquemaId, req.params.id), req.usuario.id));
});

// RF13 — o resultado da prova: nota e, conforme o professor liberou, gabarito e os
// indicadores anônimos da turma. Sem liberação, devolve o motivo e nada mais.
rotasRealizacao.get('/:id/resultado', async (req, res) => {
  res.json(await doEstudante(validar(esquemaId, req.params.id), req.usuario.id));
});

// Retomar depois de recarregar a página ou de uma queda de conexão (UC09 A2).
rotasRealizacao.get('/:id/tentativa', async (req, res) => {
  res.json(await retomar(validar(esquemaId, req.params.id), req.usuario.id));
});

// UC09: salvamento automático. Chamado periodicamente pela tela e ao sair de um campo.
rotasRealizacao.put('/:id/respostas', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { respostas } = validar(esquemaRespostas, req.body);
  res.json(await salvarRespostas(id, req.usuario.id, respostas));
});

// UC08, passos 12 a 16 (e A3): entrega. O corpo pode trazer respostas ainda não salvas.
rotasRealizacao.post('/:id/finalizar', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { respostas } = validar(esquemaFinalizar, req.body ?? {});
  res.json(await finalizar(id, req.usuario.id, respostas));
});
