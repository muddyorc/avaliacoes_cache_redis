-- 006 — A prova feita passa a registrar em qual turma foi feita.
--
-- Por quê: a comparação que o estudante vê deve ser com a turma dele, e não com o
-- conjunto de todas as turmas que receberam a mesma avaliação (decisão do autor em
-- 24/09/2026). A tentativa não guardava turma, então o recorte por turma só podia ser
-- inferido do vínculo atual — que muda quando o estudante entra ou sai de uma turma, e
-- levaria o histórico a mudar junto.
--
-- Mesmo princípio do congelamento da questão (P-22): o que a prova aplicou fica gravado
-- na própria prova.
--
-- `turma_id` aceita NULL: avaliação pública feita por quem não está em nenhuma turma
-- vinculada, e os casos ambíguos do histórico (ver o preenchimento abaixo). Nesses casos
-- a comparação usa todas as provas da avaliação, como antes.
--
-- Idempotente: pode rodar de novo sem efeito.

ALTER TABLE tentativa
  ADD COLUMN IF NOT EXISTS turma_id INTEGER REFERENCES turma (id);

CREATE INDEX IF NOT EXISTS tentativa_turma_idx ON tentativa (turma_id);

-- Preenchimento do histórico: a turma é a interseção entre as turmas da avaliação e as
-- turmas aprovadas do estudante. Só preenche quando essa interseção tem **exatamente
-- uma** turma; com duas, não há como saber por qual ele fez a prova, e inventar um
-- palpite seria pior do que deixar nulo.
UPDATE tentativa t
   SET turma_id = escolha.turma_id
  FROM (
    SELECT te.estudante_id, at.avaliacao_id, min(at.turma_id) AS turma_id
      FROM avaliacao_turma at
      JOIN turma_estudante te ON te.turma_id = at.turma_id AND te.situacao = 'APROVADA'
     GROUP BY te.estudante_id, at.avaliacao_id
    HAVING count(*) = 1
  ) AS escolha
 WHERE t.turma_id IS NULL
   AND t.estudante_id = escolha.estudante_id
   AND t.avaliacao_id = escolha.avaliacao_id;
