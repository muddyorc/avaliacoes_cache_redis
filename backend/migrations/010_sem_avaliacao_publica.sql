-- 010 — Toda avaliação é privada: pertence às turmas vinculadas.
--
-- Reversão do P-19, pedida pelo orientador em 13/10/2026. A avaliação PÚBLICA era uma
-- exceção à RN05 (migração 003): ficava aberta a qualquer estudante cadastrado, sem
-- turma. Volta a valer o DERS — o estudante vê o que é da turma dele, e nada mais.
--
-- A COLUNA NÃO É APAGADA, de propósito. `DROP COLUMN` não tem volta, e a duas semanas da
-- entrega uma migração destrutiva em banco de produção é risco desnecessário para ganho
-- estético. Em vez disso o CHECK é estreitado: o valor 'PUBLICA' deixa de ser aceito pelo
-- banco, e não só pelo código. Reverter, se um dia for preciso, é alargar o CHECK de novo.
--
-- Idempotente: pode rodar a cada publicação sem causar dano.

-- 1. O que ainda estiver público passa a privado.
--
-- ATENÇÃO ao caso de borda: uma avaliação pública SEM turma vinculada fica, a partir
-- daqui, invisível para os estudantes — nenhuma turma a alcança. Ela não se perde, e o
-- conserto é pela própria tela: o professor continua a vendo na lista dele, e a pendência
-- de publicação passa a dizer "Vincule ao menos uma turma.". É o mesmo caminho de
-- qualquer avaliação sem turma, então não há estado novo a aprender.
UPDATE avaliacao SET visibilidade = 'PRIVADA', atualizado_em = now()
 WHERE visibilidade <> 'PRIVADA';

-- 2. O banco deixa de aceitar 'PUBLICA'.
--
-- Recriado pelo nome que a migração 003 deu à restrição; se não existir, nada falha.
ALTER TABLE avaliacao DROP CONSTRAINT IF EXISTS avaliacao_visibilidade_check;

ALTER TABLE avaliacao
  ADD CONSTRAINT avaliacao_visibilidade_check CHECK (visibilidade = 'PRIVADA');
