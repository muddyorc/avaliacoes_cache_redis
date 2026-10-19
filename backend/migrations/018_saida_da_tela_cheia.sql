-- 018 — Sair da tela cheia passa a ser registrado.
--
-- Pedido do autor em 18/10/2026, junto com a prova abrindo em tela cheia. Em tela cheia
-- a barra de abas do navegador some, e trocar de aba — que é o que o monitoramento mais
-- observa — passa a exigir um passo a mais. Sair dela é, portanto, informação.
--
-- NÃO CONTA PARA O LIMITE de ocorrências, e isso é deliberado. Sair da tela cheia tem
-- causas inocentes demais para encerrar a prova de alguém: ajustar o zoom, usar um leitor
-- de tela, atender uma janela do sistema, ou simplesmente esbarrar no Esc. Encerrar a
-- avaliação por isso seria punir a ferramenta, não a conduta — a mesma razão pela qual
-- 'RECURSO_INDISPONIVEL' também fica de fora (P-06).
--
-- O professor vê o evento na linha do tempo, com a hora, e decide o que fazer. É o
-- princípio que atravessa o módulo inteiro: o sistema registra o que o navegador
-- observou, não afirma o que a pessoa fez.
--
-- POR QUE UM TIPO NOVO, e não 'ATALHO' com um detalhe: 'ATALHO' conta para o limite, e
-- reaproveitá-lo faria o Esc encerrar provas. Além disso, sair da tela cheia não é uma
-- tecla pressionada — acontece também pelo botão do navegador e ao trocar de janela em
-- alguns sistemas. Chamar as duas coisas pelo mesmo nome confundiria a leitura.
--
-- Idempotente.

ALTER TABLE evento_monitoramento DROP CONSTRAINT IF EXISTS evento_monitoramento_tipo_check;

ALTER TABLE evento_monitoramento
  ADD CONSTRAINT evento_monitoramento_tipo_check
  CHECK (tipo IN ('PERDA_FOCO', 'TROCA_ABA', 'ATALHO', 'RECURSO_INDISPONIVEL', 'SAIU_TELA_CHEIA'));

COMMENT ON COLUMN evento_monitoramento.tipo IS
  'PERDA_FOCO, TROCA_ABA e ATALHO contam para o limite de ocorrências. '
  'RECURSO_INDISPONIVEL (o navegador não oferece o recurso) e SAIU_TELA_CHEIA '
  'são registrados para o professor ler, mas não encerram a prova.';
