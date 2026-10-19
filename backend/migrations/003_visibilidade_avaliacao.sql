-- 003_visibilidade_avaliacao.sql
-- Ajuste pedido pelo autor após a Etapa 4 (22/09/2026): avaliação PÚBLICA ou PRIVADA.
--
--   PRIVADA (padrão) — disponível apenas aos estudantes das turmas vinculadas, como no
--                      DERS (RN05, UC07). Precisará de ao menos uma turma para ser
--                      publicada; essa checagem entra na Etapa 5, junto com as turmas.
--   PUBLICA          — disponível a qualquer estudante cadastrado, dentro do período,
--                      sem precisar de turma. É uma EXCEÇÃO À RN05 decidida pelo autor
--                      (registrada como P-19 no PROJECT_CONTEXT.md).
--
-- As avaliações já existentes ficam PRIVADAS, que é o comportamento original do DERS.
-- Idempotente: se a coluna já existir, o comando inteiro é ignorado.

ALTER TABLE avaliacao
  ADD COLUMN IF NOT EXISTS visibilidade TEXT NOT NULL DEFAULT 'PRIVADA'
  CONSTRAINT avaliacao_visibilidade_check CHECK (visibilidade IN ('PUBLICA', 'PRIVADA'));
