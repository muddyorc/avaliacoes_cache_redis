-- 005_divulgacao_resultados.sql
-- Extensão do RF13 decidida pelo autor em 24/09/2026: ao liberar os resultados, o
-- professor escolhe, **por avaliação**, o que o estudante enxerga além da própria nota.
--
--   nota individual  → sempre que os resultados estiverem liberados (é o próprio RF13);
--   gabarito         → as questões na ordem em que ele respondeu, com a resposta dele,
--                      o que era esperado e quanto valeu cada uma;
--   média da turma   → comparação com o grupo;
--   distribuição     → em que faixa ele caiu em relação aos colegas;
--   destaques        → questões que a turma mais acertou e mais errou.
--
-- Tudo nasce **desmarcado**: expor dado do grupo é decisão pedagógica do professor, e o
-- sistema não presume por ele. O que é do grupo é sempre anônimo (sem nome, sem nota de
-- terceiros) e só aparece com um número mínimo de provas corrigidas, checado no serviço.
--
-- Idempotente: pode rodar de novo sem efeito.

ALTER TABLE avaliacao
  ADD COLUMN IF NOT EXISTS mostrar_gabarito            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mostrar_media_turma         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mostrar_distribuicao        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mostrar_questoes_destaque   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN avaliacao.mostrar_gabarito IS
  'RF13 estendido: o estudante vê a correção questão a questão, com o gabarito.';
COMMENT ON COLUMN avaliacao.mostrar_media_turma IS
  'RF13 estendido: o estudante vê a média da turma, sem identificar ninguém.';
COMMENT ON COLUMN avaliacao.mostrar_distribuicao IS
  'RF13 estendido: o estudante vê a distribuição das notas por faixa, sem identificar ninguém.';
COMMENT ON COLUMN avaliacao.mostrar_questoes_destaque IS
  'RF13 estendido: o estudante vê as questões que a turma mais acertou e mais errou.';
