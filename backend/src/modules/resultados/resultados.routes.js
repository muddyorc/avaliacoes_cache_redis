// RF13 — rotas da consulta de resultados pelo professor (UC13 A2).
//
// Exclusivas do professor e sempre sobre as próprias turmas: a verificação de quem é o
// dono fica no serviço, junto da consulta, para não haver caminho que a contorne.
//
// A prova por dentro — nota, respostas, gabarito, feedback e as informações da correção,
// que é o passo 4 do UC13 A2 — não ganhou rota nova aqui: é exatamente o que
// `GET /api/correcao/:avaliacaoId/tentativas/:tentativaId` já devolve, e duplicar aquela
// consulta criaria duas versões da mesma verdade para manter (DT80).
import { Router } from 'express';
import { autenticar, autorizar } from '../../middleware/autenticacao.js';
import { validar, z } from '../../utils/validacao.js';
import { daTurma, doEstudanteNaTurma, listarTurmas } from './resultados.service.js';

const esquemaId = z.coerce.number({ error: 'Identificador inválido.' }).int().positive();

export const rotasResultados = Router();
rotasResultados.use(autenticar, autorizar('PROFESSOR'));

// UC13, passo 3: o que existe para consultar.
rotasResultados.get('/', async (req, res) => {
  res.json(await listarTurmas(req.usuario.id));
});

// UC13 A2, passos 1 e 2: o quadro da turma, estudante por estudante.
rotasResultados.get('/turmas/:id', async (req, res) => {
  res.json(await daTurma(validar(esquemaId, req.params.id), req.usuario.id));
});

// UC13 A2, passo 3: o histórico de um estudante nesta turma.
rotasResultados.get('/turmas/:turmaId/estudantes/:estudanteId', async (req, res) => {
  const turmaId = validar(esquemaId, req.params.turmaId);
  const estudanteId = validar(esquemaId, req.params.estudanteId);
  res.json(await doEstudanteNaTurma(turmaId, estudanteId, req.usuario.id));
});
