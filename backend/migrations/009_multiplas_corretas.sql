-- 009 — Questão objetiva com mais de uma alternativa correta.
--
-- Revoga a P-13 ("uma alternativa correta; sem múltiplas corretas"), a pedido do autor em
-- 10/10/2026. O motivo dele: numa questão de Verdadeiro ou Falso em que só se pode marcar
-- uma opção, o formato é indistinguível de uma objetiva comum de duas alternativas — o que
-- é verdade.
--
-- O que muda:
--
--   1. A questão passa a declarar o próprio tipo de resposta (`multiplas_corretas`).
--      Objetiva de resposta única continua existindo e continua sendo o padrão.
--   2. O índice que impedia duas corretas sai. Ele não pode mais existir como estava:
--      a regra deixou de ser universal e passou a depender do tipo da questão, que vive
--      em outra tabela — e índice parcial não enxerga coluna de tabela vizinha.
--      A garantia migra para a aplicação, onde o tipo é conhecido. É uma perda real de
--      rigor, registrada como tal (DT82).
--   3. Nasce `resposta_alternativa`, que guarda as marcações de uma resposta de múltipla
--      escolha. A `resposta.alternativa_id` continua servindo a resposta única, intacta:
--      nenhuma linha existente é reescrita, e o caminho que funciona hoje não é mexido a
--      duas semanas da entrega.
--
-- Idempotente.

-- ------------------------------------------------ 1. o tipo de resposta da questão
ALTER TABLE questao
  ADD COLUMN IF NOT EXISTS multiplas_corretas BOOLEAN NOT NULL DEFAULT FALSE;

-- A prova congelada (migração 004) guarda a própria cópia: se a questão do banco virar
-- múltipla depois, a prova já aplicada continua sendo o que o estudante respondeu.
ALTER TABLE avaliacao_questao
  ADD COLUMN IF NOT EXISTS multiplas_corretas BOOLEAN;

COMMENT ON COLUMN questao.multiplas_corretas IS
  'Objetiva em que mais de uma alternativa pode ser correta; o estudante marca todas as que julga verdadeiras (P-26).';

-- ------------------------------------------------ 2. uma correta deixa de ser lei do banco
DROP INDEX IF EXISTS alternativa_uma_correta;

-- O que ainda dá para garantir aqui: questão de resposta única não pode ter duas corretas.
-- Como `multiplas_corretas` está em `questao` e o índice vive em `alternativa`, a condição
-- não cabe num índice parcial. Fica a trava mais fraca que é possível sem gatilho: ao menos
-- impedir duas corretas com a mesma ordem, que já existia pela UNIQUE (questao_id, ordem).
-- A regra completa é verificada em `questoes.service.js`, com teste próprio.

-- ------------------------------------------------ 3. as marcações da resposta múltipla
CREATE TABLE IF NOT EXISTS resposta_alternativa (
  resposta_id              INTEGER NOT NULL REFERENCES resposta (id) ON DELETE CASCADE,
  -- Uma das duas é preenchida, nunca as duas: a alternativa vem do banco enquanto a prova
  -- não foi congelada, e da cópia da prova depois disso (migração 004).
  alternativa_id           INTEGER REFERENCES alternativa (id) ON DELETE CASCADE,
  avaliacao_alternativa_id INTEGER REFERENCES avaliacao_alternativa (id) ON DELETE CASCADE,
  CONSTRAINT resposta_alternativa_origem_unica CHECK (
    (alternativa_id IS NOT NULL AND avaliacao_alternativa_id IS NULL)
    OR (alternativa_id IS NULL AND avaliacao_alternativa_id IS NOT NULL)
  )
);

-- Mesma alternativa marcada duas vezes na mesma resposta não é marcação, é defeito.
CREATE UNIQUE INDEX IF NOT EXISTS resposta_alternativa_unica_banco
  ON resposta_alternativa (resposta_id, alternativa_id) WHERE alternativa_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resposta_alternativa_unica_prova
  ON resposta_alternativa (resposta_id, avaliacao_alternativa_id) WHERE avaliacao_alternativa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS resposta_alternativa_resposta_idx ON resposta_alternativa (resposta_id);
