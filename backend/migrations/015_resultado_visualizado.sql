-- 015 — Quando o estudante viu o resultado da própria prova.
--
-- Pedido do autor em 18/10/2026, junto do sino de avisos. O aviso "saiu a sua nota"
-- precisa parar de aparecer em algum momento, e o único momento honesto é quando a pessoa
-- de fato abriu o resultado — não quando ela fechou um pop-up, nem depois de N dias.
--
-- POR QUE NO BANCO, e não no navegador: guardar isso em `localStorage` faria o aviso
-- ressurgir a cada troca de navegador ou de máquina, dizendo "novidade" sobre algo que a
-- pessoa já leu. O estudante faz prova no laboratório e consulta a nota no celular; o
-- sistema precisa lembrar disso em qualquer um dos dois.
--
-- POR QUE NÃO UMA TABELA DE NOTIFICAÇÕES: os dois avisos que o sino mostra já são
-- dedutíveis do que existe — prazo próximo sai da avaliação, nota liberada sai da
-- tentativa. Criar uma tabela de notificações obrigaria a gerar linha a cada mudança de
-- estado, com um processo para isso, e a manter as duas versões da verdade em sincronia.
-- Uma coluna fecha a única lacuna real: o "já vi".
--
-- O "prazo próximo" não precisa de coluna nenhuma: ele deixa de valer sozinho quando a
-- prova é entregue ou o prazo vence.
--
-- Idempotente.

ALTER TABLE tentativa
  ADD COLUMN IF NOT EXISTS visualizado_em TIMESTAMPTZ;

COMMENT ON COLUMN tentativa.visualizado_em IS
  'Quando o estudante abriu o resultado desta prova, já liberado pelo professor. '
  'Nulo enquanto ele não tiver visto. Usado pelo sino de avisos.';
