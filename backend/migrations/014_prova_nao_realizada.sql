-- 014 — A prova de quem não fez dentro do prazo passa a existir, em branco.
--
-- Decisão do autor em 17/10/2026. Até aqui, o estudante que deixava o prazo vencer sem
-- abrir a prova simplesmente não tinha tentativa — e a ausência de linha tornava esse
-- aluno invisível para quase tudo: não aparecia na correção, não entrava na média da
-- turma, e a tela de resultado lhe respondia 404, então ele era o único da turma que não
-- podia nem ver o gabarito depois de liberado.
--
-- Em vez de tratar "sem tentativa" como caso especial em cada consulta, a ausência vira
-- um registro: uma tentativa sem respostas, encerrada no prazo da prova, com nota zero.
-- Daí em diante o fluxo normal vale para a turma inteira, sem exceção.
--
-- POR QUE UMA SITUAÇÃO NOVA, e não reaproveitar 'TEMPO_ESGOTADO': as duas acabam em zero,
-- mas contam histórias diferentes. 'TEMPO_ESGOTADO' é de quem começou e não terminou —
-- fez a prova. Quem nunca abriu não teve tempo esgotado; faltou. O professor lê essa
-- diferença na correção, e o estudante lê na própria tela: "você não realizou esta
-- avaliação" é verdade, "seu tempo acabou" não seria.
--
-- A nota zero entra nas médias e nos gráficos como qualquer outra (decisão do autor na
-- mesma conversa): os números passam a ser sobre a turma inteira, e não só sobre quem
-- compareceu.
--
-- As duas outras restrições da tabela continuam valendo sem ajuste: a prova não realizada
-- não é 'BLOQUEADA', e tem `finalizada_em` preenchida — com o prazo da avaliação, não com
-- a hora em que o sistema a criou, pela mesma razão do encerramento por tempo (a prova
-- acabou na hora do prazo, não quando alguém reparou nisso).
--
-- Idempotente.

ALTER TABLE tentativa DROP CONSTRAINT IF EXISTS tentativa_status_check;

ALTER TABLE tentativa
  ADD CONSTRAINT tentativa_status_check
  CHECK (status IN ('EM_ANDAMENTO', 'FINALIZADA', 'TEMPO_ESGOTADO', 'BLOQUEADA', 'NAO_REALIZADA'));

COMMENT ON COLUMN tentativa.status IS
  'EM_ANDAMENTO, FINALIZADA (entregue), TEMPO_ESGOTADO (começou e o prazo venceu), '
  'BLOQUEADA (limite de ocorrências) ou NAO_REALIZADA (nunca iniciou; a prova foi '
  'registrada em branco quando o período terminou).';
