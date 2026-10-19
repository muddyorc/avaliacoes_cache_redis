// Regra de domínio do monitoramento: o que conta como ocorrência.
//
// Vive aqui, e não dentro do módulo, porque dois módulos precisam da mesma resposta — o
// monitoramento, que aplica o limite, e a correção, que mostra o número ao lado da nota
// desde que as duas telas viraram uma (item 9 do feedback do orientador). Importar um
// módulo do outro criaria um ciclo; e, pior, duplicar a lista criaria duas noções
// diferentes do que é uma "ocorrência", que divergiriam na primeira mudança.
//
// Função pura, sem banco: é testável sozinha, como o resto de `dominio/`.

// Eventos que contam para o limite de ocorrências.
//
// `SAIU_TELA_CHEIA` também fica de fora (migração 018): sair da tela cheia tem causas
// inocentes demais — ajustar o zoom, usar um leitor de tela, esbarrar no Esc — para
// encerrar a prova de alguém. Fica registrado para o professor ler.
//
// `RECURSO_INDISPONIVEL` fica de fora: ele diz que o navegador do estudante não oferece
// determinado recurso de monitoramento (UC10 A5). É informação técnica sobre o ambiente,
// não algo que a pessoa fez — bloquear alguém por causa do navegador que ela usa seria
// punir a ferramenta, não a conduta.
export const CONTAM_PARA_O_LIMITE = ['PERDA_FOCO', 'TROCA_ABA', 'ATALHO'];

// É a regra que separa "o estudante fez algo" de "o navegador dele não oferece um
// recurso". Ela decide quem pode ter a prova encerrada.
export const contaParaOLimite = (tipo) => CONTAM_PARA_O_LIMITE.includes(tipo);
