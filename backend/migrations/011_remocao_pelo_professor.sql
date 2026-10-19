-- 011 — O professor pode remover um estudante da turma.
--
-- Pedido do autor em 13/10/2026. Até aqui só o estudante saía por conta própria
-- (migração 007); o professor não tinha como desfazer uma entrada errada.
--
-- POR QUE NÃO UMA SITUAÇÃO NOVA: a saída já é exclusão lógica com `situacao = 'SAIU'`, e
-- dez pontos do código filtram por esse valor. Criar 'REMOVIDA' obrigaria a revisar todos
-- eles, com o risco de esquecer um e fazer alguém sumir do histórico da turma.
--
-- Uma coluna resolve melhor: `removido_por` diz QUEM encerrou o vínculo — nulo quando o
-- próprio estudante saiu. Guarda mais informação que uma situação nova guardaria (a
-- identidade de quem removeu), e nenhum filtro existente precisa mudar.
--
-- Isso importa para o texto que cada lado lê: dizer "saiu da turma" sobre quem foi
-- removido é falso, e num sistema que toma cuidado com linguagem que acusa (P-06) a
-- imprecisão destoa do resto.
--
-- O que o estudante já fez continua existindo: as provas guardam a própria turma desde a
-- migração 006, e o módulo de resultados inclui 'SAIU' de propósito.
--
-- Idempotente.

ALTER TABLE turma_estudante
  ADD COLUMN IF NOT EXISTS removido_por INTEGER REFERENCES usuario (id);

COMMENT ON COLUMN turma_estudante.removido_por IS
  'Professor que removeu o estudante da turma. Nulo quando o próprio estudante saiu.';
