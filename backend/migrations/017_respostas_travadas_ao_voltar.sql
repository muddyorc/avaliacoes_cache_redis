-- 017 — Resposta dada antes de sair da prova não é mais alterada ao voltar.
--
-- Decisão do autor em 18/10/2026, estendendo a trava que a devolução de prova já tinha
-- (migração 016): o que vale para quem recebe a prova de volta do professor passa a
-- valer também para quem fecha a prova e volta por conta própria.
--
-- A regra, em uma frase: **o que foi respondido antes de você sair fica como está.**
--
-- POR QUE UMA COLUNA DE MOMENTO, e não um sinalizador por resposta: a trava não é uma
-- propriedade da resposta, é uma comparação com o instante em que o estudante voltou.
-- Uma coluna `travada` em `resposta` precisaria ser escrita em cada retomada, para cada
-- linha — e ficaria errada no segundo em que alguém esquecesse de atualizá-la. Aqui o
-- momento é gravado uma vez e a comparação é feita na leitura, sempre consistente.
--
-- `retomada_em` guarda a última vez que a prova foi ABERTA depois de já existir. Junto
-- com a última reabertura (migração 016), forma a fronteira: resposta com
-- `atualizada_em` anterior à fronteira está fechada; o que vier depois continua editável
-- até a entrega — senão um clique errado logo após voltar seria irreversível.
--
-- CONSEQUÊNCIA QUE PRECISA ESTAR ESCRITA: recarregar a página conta como voltar. Um F5
-- acidental fecha o que já tinha sido salvo até ali. É o preço da regra, e o autor optou
-- por ele conscientemente — a prova passa a se comportar como uma sequência de respostas
-- confirmadas, e não como um formulário editável até o fim.
--
-- Idempotente.

ALTER TABLE tentativa
  ADD COLUMN IF NOT EXISTS retomada_em TIMESTAMPTZ;

COMMENT ON COLUMN tentativa.retomada_em IS
  'Última vez que o estudante reabriu esta prova. Respostas anteriores a este momento '
  'não podem mais ser alteradas (migração 017).';
