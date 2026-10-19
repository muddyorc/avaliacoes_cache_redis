-- 007 — O estudante pode cancelar a própria inscrição na turma.
--
-- Até aqui, só o professor decidia o vínculo (aprovar/recusar). O estudante que entrou
-- na turma errada, ou que terminou o semestre, não tinha como sair — decisão do autor em
-- 24/09/2026, inspirada no "Cancelar inscrição" do Google Sala de Aula.
--
-- Sair é **exclusão lógica**: a linha permanece, com a situação nova `SAIU` e a data.
-- Apagar o vínculo apagaria o registro de que aquele estudante participou da turma, e
-- nada que possa integrar o histórico é removido fisicamente neste sistema.
--
-- As provas que ele já fez continuam existindo e continuam contando para o professor:
-- elas guardam a própria turma desde a migração 006.
--
-- Idempotente.

ALTER TABLE turma_estudante
  ADD COLUMN IF NOT EXISTS saiu_em TIMESTAMPTZ;

-- O CHECK precisa aceitar a situação nova. Recriado pelo nome que o PostgreSQL deu ao
-- criar a tabela (001); se o nome não existir, a instrução não falha.
ALTER TABLE turma_estudante DROP CONSTRAINT IF EXISTS turma_estudante_situacao_check;

ALTER TABLE turma_estudante
  ADD CONSTRAINT turma_estudante_situacao_check
  CHECK (situacao IN ('PENDENTE', 'APROVADA', 'RECUSADA', 'SAIU'));
