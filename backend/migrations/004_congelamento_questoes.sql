-- 004_congelamento_questoes.sql
-- Decisão do autor em 24/09/2026: a questão do BANCO pode ser sempre editada; o que não
-- pode mudar é a questão **dentro de uma prova já aplicada**.
--
-- Até aqui o modelo era por referência: a prova apontava para a questão do banco e a
-- resposta do estudante apontava para a alternativa do banco. Como a prova não tinha
-- cópia própria, editar a questão mudaria retroativamente uma prova já feita — e por isso
-- o sistema travava a questão (P-16).
--
-- A partir desta migração a prova guarda a **sua** cópia (snapshot): enunciado, tipo,
-- resposta esperada, critérios e alternativas, com o gabarito daquele momento. O momento
-- do congelamento é o **primeiro estudante que inicia a prova**, o mesmo instante em que
-- a avaliação já ficava estruturalmente bloqueada (P-15a).
--
-- Nada é apagado: as colunas antigas continuam, agora como referência de origem.
-- Idempotente: pode rodar de novo sem efeito.

-- ------------------------------------------------- 1. snapshot da questão na prova
ALTER TABLE avaliacao_questao
  ADD COLUMN IF NOT EXISTS enunciado          TEXT,
  ADD COLUMN IF NOT EXISTS tipo               TEXT,
  ADD COLUMN IF NOT EXISTS tema               TEXT,
  ADD COLUMN IF NOT EXISTS resposta_esperada  TEXT,
  ADD COLUMN IF NOT EXISTS criterios_correcao TEXT,
  -- Preenchida no congelamento; nula enquanto a prova ainda acompanha o banco.
  ADD COLUMN IF NOT EXISTS congelada_em       TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'avaliacao_questao_tipo_check') THEN
    ALTER TABLE avaliacao_questao
      ADD CONSTRAINT avaliacao_questao_tipo_check
      CHECK (tipo IS NULL OR tipo IN ('OBJETIVA', 'DISCURSIVA'));
  END IF;
END $$;

-- ------------------------------------------ 2. alternativas congeladas da prova
CREATE TABLE IF NOT EXISTS avaliacao_alternativa (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  avaliacao_id INTEGER NOT NULL,
  questao_id   INTEGER NOT NULL,
  -- De onde a cópia veio. Só rastreabilidade: se a alternativa do banco for reescrita,
  -- o texto congelado aqui continua sendo o que o estudante viu.
  origem_id    INTEGER REFERENCES alternativa (id) ON DELETE SET NULL,
  ordem        SMALLINT NOT NULL CHECK (ordem > 0),
  texto        TEXT NOT NULL CHECK (length(trim(texto)) > 0),
  correta      BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (avaliacao_id, questao_id) REFERENCES avaliacao_questao (avaliacao_id, questao_id) ON DELETE CASCADE,
  UNIQUE (avaliacao_id, questao_id, ordem)
);

CREATE INDEX IF NOT EXISTS avaliacao_alternativa_questao_idx
  ON avaliacao_alternativa (avaliacao_id, questao_id);

-- ------------------------------------------ 3. a resposta aponta para a cópia
-- `resposta.alternativa_id` continua existindo como origem; a correção passa a usar a
-- alternativa congelada, que é o que o estudante realmente viu na prova.
ALTER TABLE resposta
  ADD COLUMN IF NOT EXISTS avaliacao_alternativa_id INTEGER REFERENCES avaliacao_alternativa (id);

-- A alternativa do banco pode ser reescrita depois que a prova congelou; o ponteiro de
-- origem então se perde, sem levar junto a resposta do estudante.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resposta_alternativa_id_fkey') THEN
    ALTER TABLE resposta DROP CONSTRAINT resposta_alternativa_id_fkey;
  END IF;
  ALTER TABLE resposta
    ADD CONSTRAINT resposta_alternativa_id_fkey
    FOREIGN KEY (alternativa_id) REFERENCES alternativa (id) ON DELETE SET NULL;
END $$;

-- ------------------------------------------ 4. provas já iniciadas: congelar agora
-- O estado atual do banco é o que essas provas aplicaram, então é ele que vira o
-- snapshot. Provas ainda não iniciadas continuam acompanhando o banco.
UPDATE avaliacao_questao aq
   SET enunciado          = q.enunciado,
       tipo               = q.tipo,
       tema               = q.tema,
       resposta_esperada  = q.resposta_esperada,
       criterios_correcao = q.criterios_correcao,
       congelada_em       = now()
  FROM questao q
 WHERE q.id = aq.questao_id
   AND aq.congelada_em IS NULL
   AND EXISTS (SELECT 1 FROM tentativa t WHERE t.avaliacao_id = aq.avaliacao_id);

INSERT INTO avaliacao_alternativa (avaliacao_id, questao_id, origem_id, ordem, texto, correta)
SELECT aq.avaliacao_id, aq.questao_id, a.id, a.ordem, a.texto, a.correta
  FROM avaliacao_questao aq
  JOIN alternativa a ON a.questao_id = aq.questao_id
 WHERE aq.congelada_em IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM avaliacao_alternativa ea
      WHERE ea.avaliacao_id = aq.avaliacao_id AND ea.questao_id = aq.questao_id
   );

-- As respostas já dadas passam a apontar para a cópia correspondente.
UPDATE resposta r
   SET avaliacao_alternativa_id = ea.id
  FROM tentativa t, avaliacao_alternativa ea
 WHERE t.id = r.tentativa_id
   AND ea.avaliacao_id = t.avaliacao_id
   AND ea.questao_id = r.questao_id
   AND ea.origem_id = r.alternativa_id
   AND r.alternativa_id IS NOT NULL
   AND r.avaliacao_alternativa_id IS NULL;
