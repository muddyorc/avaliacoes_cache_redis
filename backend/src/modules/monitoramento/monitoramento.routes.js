// RF10 / UC10 — rotas do monitoramento.
//
// São duas conversas diferentes: o estudante **relata** o que aconteceu no navegador
// dele, e o professor **consulta** o que foi registrado. Por isso dois roteadores, com
// perfis distintos — o estudante nunca lê o que o professor lê.
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import { TIPOS, eventosDaTentativa, registrarEventos, resumoDaAvaliacao } from './monitoramento.service.js';

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

const esquemaEventos = z.object({
  eventos: z
    .array(
      z.object({
        tipo: z.enum(TIPOS, { error: 'Tipo de evento inválido.' }),
        // O detalhe descreve o que o navegador viu — por exemplo, a combinação de teclas.
        // É texto curto e vai para o relatório do professor, então tem limite firme.
        detalhe: z.string().trim().max(120, 'Detalhe longo demais.').nullish(),
      }),
      { error: 'Envie a lista de eventos.' },
    )
    // Lote generoso o bastante para uma rajada de eventos, e pequeno o bastante para não
    // virar um canal de escrita em massa no banco.
    .min(1, 'Envie pelo menos um evento.')
    .max(50, 'Envie no máximo 50 eventos por vez.'),
});

// ------------------------------------------------------------------ estudante

export const rotasMonitoramentoEstudante = Router();
rotasMonitoramentoEstudante.use(autenticar, autorizar('ESTUDANTE'));

// POST /api/estudante/avaliacoes/:id/eventos — relata os eventos da própria prova.
//
// Devolve o estado do monitoramento (ocorrências, limite, se foi bloqueada) porque é
// assim que a tela sabe que precisa encerrar a prova — sem precisar perguntar de novo.
rotasMonitoramentoEstudante.post('/:id/eventos', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { eventos } = validar(esquemaEventos, req.body);
  res.json(await registrarEventos(id, req.usuario.id, eventos));
});

// ------------------------------------------------------------------ professor

export const rotasMonitoramento = Router();
rotasMonitoramento.use(autenticar, autorizar('PROFESSOR'));

// GET /api/monitoramento/:avaliacaoId — quem teve ocorrências nesta avaliação.
rotasMonitoramento.get('/:avaliacaoId', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  res.json(await resumoDaAvaliacao(avaliacaoId, req.usuario.id));
});

// GET /api/monitoramento/:avaliacaoId/tentativas/:id — a linha do tempo de uma prova.
rotasMonitoramento.get('/:avaliacaoId/tentativas/:id', async (req, res) => {
  const avaliacaoId = validar(esquemaId, req.params.avaliacaoId);
  const tentativaId = validar(esquemaId, req.params.id);
  res.json(await eventosDaTentativa(avaliacaoId, tentativaId, req.usuario.id));
});
