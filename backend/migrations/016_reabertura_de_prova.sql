-- 016 — O professor devolve a prova ao estudante, com tempo novo.
--
-- Pergunta do autor em 18/10/2026, e um buraco real: acabou a energia no meio da prova,
-- o navegador fechou, o monitoramento bloqueou alguém injustamente — e não havia saída.
-- O `iniciar` recusa tentativa que não esteja em andamento (P-04), e o índice único
-- impede uma segunda. A única correção possível era um UPDATE na mão no banco.
--
-- REABRIR NÃO É UMA SEGUNDA TENTATIVA. A P-04 continua valendo: é a MESMA tentativa,
-- devolvida ao estudante com prazo novo. As respostas que ele já tinha dado permanecem —
-- ele continua de onde parou, e não recomeça do zero. Isso é consequência direta da P-02:
-- apagar as respostas anteriores para "zerar" a prova seria exclusão física de registro.
--
-- POR QUE UMA TABELA, e não três colunas em `tentativa`: a mesma prova pode ser reaberta
-- mais de uma vez — caiu a energia, voltou, caiu de novo. Com colunas, a segunda
-- reabertura apagaria a primeira, e some justamente a informação que torna a exceção
-- defensável: quantas vezes, por quem e por quê. Aqui cada reabertura é uma linha.
--
-- `situacao_anterior` guarda o estado de onde a prova voltou. É o que distingue "estava
-- entregue e foi devolvida" de "o tempo tinha esgotado" ou de "o monitoramento bloqueou"
-- — três histórias diferentes que, depois da reabertura, teriam a mesma aparência.
--
-- O contador de ocorrências do monitoramento passa a valer A PARTIR da última reabertura.
-- Sem isso, quem foi bloqueado em 3 de 3 seria bloqueado de novo no primeiro evento, e o
-- botão nasceria inútil no caso que mais justifica a existência dele. Os eventos antigos
-- continuam gravados e visíveis na linha do tempo: deixam de contar, não de existir.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS reabertura_tentativa (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tentativa_id      INTEGER NOT NULL REFERENCES tentativa (id),
  professor_id      INTEGER NOT NULL REFERENCES usuario (id),
  reaberta_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  minutos           INTEGER NOT NULL CHECK (minutos > 0 AND minutos <= 600),
  -- Obrigatório: o sistema permite a exceção, mas não deixa que ela seja silenciosa.
  motivo            TEXT NOT NULL CHECK (length(trim(motivo)) > 0),
  situacao_anterior TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reabertura_tentativa_idx ON reabertura_tentativa (tentativa_id);

COMMENT ON TABLE reabertura_tentativa IS
  'Cada vez que o professor devolveu uma prova ao estudante, com o motivo. A tentativa '
  'continua sendo uma só (P-04); o que se repete é a devolução.';

COMMENT ON COLUMN reabertura_tentativa.situacao_anterior IS
  'Estado da tentativa no momento da reabertura: FINALIZADA, TEMPO_ESGOTADO, BLOQUEADA, '
  'NAO_REALIZADA ou EM_ANDAMENTO (neste caso foi só acréscimo de tempo).';
