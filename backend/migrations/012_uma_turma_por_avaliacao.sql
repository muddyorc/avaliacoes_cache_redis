-- 012 — Uma avaliação pertence a UMA turma.
--
-- Decisão do autor em 15/10/2026. Até aqui `avaliacao_turma` era N:N e a mesma prova
-- podia ir para várias turmas. O efeito colateral era a prova não ter lugar: ela não
-- morava em turma nenhuma, e por isso precisava de uma listagem própria ("Avaliações")
-- para ser encontrada — uma tela a mais para resolver um problema que o modelo criava.
--
-- Com uma turma por prova, a prova mora na turma, como a atividade mora na turma do
-- Google Classroom. Quem quiser a mesma avaliação em outra turma **duplica**.
--
-- O reaproveitamento não se perde; ele muda de nível. As QUESTÕES continuam
-- compartilhadas entre quantas provas forem (`avaliacao_questao` segue N:N, e é o banco
-- de questões que faz esse trabalho desde o RF05). O que deixa de ser compartilhado é a
-- prova montada — que é justamente o que confundia, porque corrigir, publicar ou
-- arquivar afetava turmas que o professor não estava olhando.
--
-- A TABELA CONTINUA SENDO A MESMA, de propósito: dezenas de consultas fazem JOIN com
-- `avaliacao_turma`, e trocá-la por uma coluna em `avaliacao` obrigaria a reescrever
-- todas. Um índice único no `avaliacao_id` entrega a regra sem tocar em nenhuma.
--
-- Idempotente.

-- Provas em mais de uma turma impediriam o índice. Nenhuma existe no banco do autor
-- (verificado em 15/10/2026), mas a migração precisa ser segura em qualquer banco: o
-- vínculo mais antigo de cada avaliação fica, e os demais saem. O critério é a data de
-- vinculação — o primeiro vínculo é o que o professor fez ao criar a prova.
DELETE FROM avaliacao_turma at
 WHERE EXISTS (
   SELECT 1 FROM avaliacao_turma anterior
    WHERE anterior.avaliacao_id = at.avaliacao_id
      AND (anterior.vinculado_em, anterior.turma_id) < (at.vinculado_em, at.turma_id)
 );

CREATE UNIQUE INDEX IF NOT EXISTS avaliacao_turma_uma_por_avaliacao
  ON avaliacao_turma (avaliacao_id);
