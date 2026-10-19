-- 008 — Registra qual modelo de IA gerou cada sugestão de nota.
--
-- As colunas `nota_sugerida_ia`, `justificativa_ia` e `ia_solicitada_em` já existiam desde
-- a migração 001. Faltava saber **de onde** veio a sugestão.
--
-- Por que isso importa: o professor pode consultar uma correção meses depois, e a
-- qualidade de uma sugestão depende do modelo que a produziu. Sem esse registro, duas
-- sugestões feitas com modelos diferentes ficariam indistinguíveis — e, se um modelo for
-- substituído, não haveria como saber quais notas foram sugeridas pelo anterior.
--
-- Também vale como rastreabilidade do próprio trabalho: é o que permite afirmar, com
-- base no dado, qual modelo foi usado nas correções demonstradas.
--
-- Idempotente.

ALTER TABLE resposta
  ADD COLUMN IF NOT EXISTS ia_modelo TEXT;

COMMENT ON COLUMN resposta.ia_modelo IS
  'Modelo de IA que gerou a sugestão (RF11). "simulado" quando gerada sem serviço externo.';
