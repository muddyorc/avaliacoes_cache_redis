-- 013 — Nem toda questão precisa ir para o banco de questões.
--
-- Pedido do orientador em 15/10/2026. Até aqui, criar uma questão dentro da prova (P-21)
-- a cadastrava no banco automaticamente — e o banco enchia de questões que o professor
-- escreveu para uma prova específica e nunca vai reusar.
--
-- O banco de questões existe para REUSO (RF05). Uma questão que nasceu para uma prova e
-- serve só a ela não é material de reuso; é conteúdo daquela prova. Misturar as duas
-- coisas faz o banco perder a utilidade justamente por excesso.
--
-- `no_banco` separa as duas: a questão continua na tabela `questao` (a prova precisa dela
-- lá, e `avaliacao_questao` aponta para ela), mas só aparece no banco quando o professor
-- disser que quer. O botão "Adicionar ao banco", ao lado de "Remover", é quem vira a chave.
--
-- POR QUE UMA COLUNA, e não uma tabela separada de "questões da prova": duplicar a
-- estrutura obrigaria a duplicar alternativas, congelamento (P-22), correção e tudo o
-- mais que já funciona. A questão é a mesma coisa; o que muda é onde ela aparece.
--
-- As existentes ficam TRUE: elas já estavam no banco, e tirá-las de lá retroativamente
-- seria apagar trabalho que o professor fez.
--
-- Idempotente.

ALTER TABLE questao
  ADD COLUMN IF NOT EXISTS no_banco BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN questao.no_banco IS
  'Se a questão aparece no banco de questões (RF05). Falso para as criadas dentro de uma prova e ainda não promovidas.';

-- O banco é consultado por professor e situação; quem não está no banco nunca entra nessa
-- listagem, então o índice parcial atende a consulta sem crescer com o que não é usado.
CREATE INDEX IF NOT EXISTS questao_no_banco_idx
  ON questao (professor_id) WHERE no_banco;
