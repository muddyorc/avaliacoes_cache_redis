// RF12 — rotas do dashboard de desempenho (UC12). Exclusivas do professor, sobre as
// próprias avaliações e turmas.
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import { daAvaliacao, daTurma, listarFontes } from './dashboard.service.js';

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();
const esquemaFiltro = z.object({ turmaId: esquemaId.optional() });

export const rotasDashboard = Router();
rotasDashboard.use(autenticar, autorizar('PROFESSOR'));

// UC12, passo 2: o que existe para analisar.
rotasDashboard.get('/', async (req, res) => {
  const { turmaId } = validar(esquemaFiltro, req.query);
  res.json(await listarFontes(req.usuario.id, { turmaId: turmaId ?? null }));
});

// Indicadores de uma avaliação, opcionalmente restritos a uma turma.
rotasDashboard.get('/avaliacoes/:id', async (req, res) => {
  const id = validar(esquemaId, req.params.id);
  const { turmaId } = validar(esquemaFiltro, req.query);
  res.json(await daAvaliacao(id, req.usuario.id, { turmaId }));
});

// Indicadores de uma turma, somando as avaliações vinculadas a ela.
rotasDashboard.get('/turmas/:id', async (req, res) => {
  res.json(await daTurma(validar(esquemaId, req.params.id), req.usuario.id));
});
