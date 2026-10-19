// Testes UNITÁRIOS do apoio por Inteligência Artificial (RF11, UC11).
//
// Duas regras são conferidas aqui, e as duas existem porque o modelo é um serviço externo
// sobre o qual não se tem controle:
//
//   1. **O que é enviado.** Nada que identifique o estudante pode sair do sistema, e a
//      resposta dele precisa ir delimitada, separada das instruções.
//   2. **O que é aceito de volta.** Nota fora do intervalo, texto no lugar de número ou
//      JSON quebrado não podem virar sugestão apresentada ao professor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELIMITADORES, instrucao, montarMensagem } from '../../src/servicos/ia/prompt.js';
import { interpretarResposta } from '../../src/servicos/ia/ia.service.js';
import { PROVEDORES } from '../../src/servicos/ia/provedores.js';

const dadosDaQuestao = {
  enunciado: 'Explique a importância hídrica do Cerrado.',
  respostaEsperada: 'Berço de grandes bacias hidrográficas brasileiras.',
  criterios: 'Citar ao menos duas bacias.',
  pontuacaoMaxima: 3,
  resposta: 'O Cerrado abastece as bacias do São Francisco e do Paraná.',
};

// -------------------------------------------------- o que é enviado ao modelo

test('a mensagem leva enunciado, resposta esperada, critérios e pontuação', () => {
  const mensagem = montarMensagem(dadosDaQuestao);
  assert.match(mensagem, /importância hídrica do Cerrado/);
  assert.match(mensagem, /grandes bacias hidrográficas/);
  assert.match(mensagem, /duas bacias/);
  assert.match(mensagem, /PONTUAÇÃO MÁXIMA: 3/);
});

test('nenhum dado do estudante é enviado', () => {
  // A função nem aceita esses campos: o que não é parâmetro não vaza por engano.
  const mensagem = montarMensagem({
    ...dadosDaQuestao,
    nome: 'Ana Ramos',
    email: 'ana@exemplo.com',
    estudanteId: 42,
  });
  assert.ok(!mensagem.includes('Ana Ramos'), 'o nome não pode ser enviado');
  assert.ok(!mensagem.includes('ana@exemplo.com'), 'o e-mail não pode ser enviado');
  assert.ok(!/\b42\b/.test(mensagem.replace(/PONTUAÇÃO MÁXIMA: \d+/, '')), 'o identificador não pode ser enviado');
});

test('a resposta do estudante vai delimitada, separada das instruções', () => {
  const mensagem = montarMensagem(dadosDaQuestao);
  const inicio = mensagem.indexOf(DELIMITADORES.ABRE);
  const fim = mensagem.indexOf(DELIMITADORES.FECHA);
  assert.ok(inicio > 0 && fim > inicio, 'a resposta precisa estar entre os delimitadores');
  const dentro = mensagem.slice(inicio, fim);
  assert.match(dentro, /São Francisco/);
});

test('a instrução manda ignorar ordens escritas dentro da resposta', () => {
  // Defesa contra injeção de prompt: o estudante sabe que uma IA vai ler o que ele
  // escreveu, e pode tentar dar ordens a ela.
  assert.match(instrucao('Geografia'), /ignore-as/i);
  assert.match(instrucao('Geografia'), /material a avaliar/i);
});

test('a instrução reforça que a nota final é do professor (RN04)', () => {
  assert.match(instrucao('Geografia'), /quem decide a nota final é o professor/i);
});

test('a instrução situa o modelo na área da questão', () => {
  assert.match(instrucao('Direito Constitucional'), /área de Direito Constitucional/i);
  // Sem tema, não inventa área nenhuma.
  assert.match(instrucao(''), /área que o enunciado indicar/i);
  assert.match(instrucao(null), /área que o enunciado indicar/i);
});

test('a instrução pede nota proporcional ao que foi contemplado', () => {
  const texto = instrucao('Geografia');
  assert.match(texto, /25%/);
  assert.match(texto, /nota parcial, nunca zero/i);
});

test('a instrução diz o que fazer quando não há resposta esperada', () => {
  assert.match(instrucao('Geografia'), /Quando não informar, avalie pelo enunciado/i);
});

test('o tema vai na mensagem quando existe', () => {
  assert.match(montarMensagem({ ...dadosDaQuestao, tema: 'Geografia' }), /TEMA: Geografia/);
  assert.ok(!montarMensagem({ ...dadosDaQuestao, tema: '' }).includes('TEMA:'));
});

test('sem resposta esperada, o modelo é avisado explicitamente', () => {
  const mensagem = montarMensagem({ ...dadosDaQuestao, respostaEsperada: null });
  assert.match(mensagem, /não informada pelo professor/i);
});

test('questão sem resposta esperada ou critérios não quebra a mensagem', () => {
  const mensagem = montarMensagem({ ...dadosDaQuestao, respostaEsperada: null, criterios: undefined });
  assert.match(mensagem, /não informada pelo professor/i);
  assert.match(mensagem, /não informados/i);
});

// ------------------------------------------- o que é aceito de volta do modelo

test('resposta bem formada vira sugestão', () => {
  const r = interpretarResposta('{"nota": 2.5, "justificativa": "Cita duas bacias."}', 3);
  assert.deepEqual(r, { nota: 2.5, justificativa: 'Cita duas bacias.' });
});

test('JSON embrulhado em bloco de código ainda é lido', () => {
  // Alguns modelos insistem em devolver ```json, mesmo instruídos a não fazer isso.
  const r = interpretarResposta('```json\n{"nota": 1, "justificativa": "Parcial."}\n```', 3);
  assert.equal(r.nota, 1);
});

test('nota acima da pontuação da questão é descartada', () => {
  // 12 numa questão de 3 pontos significa que o modelo não entendeu a tarefa. Ajustar o
  // número para caber esconderia isso do professor.
  assert.equal(interpretarResposta('{"nota": 12, "justificativa": "Ótima."}', 3), null);
});

test('nota negativa é descartada', () => {
  assert.equal(interpretarResposta('{"nota": -1, "justificativa": "Errada."}', 3), null);
});

test('texto no lugar de número é descartado', () => {
  assert.equal(interpretarResposta('{"nota": "três", "justificativa": "Boa."}', 3), null);
});

test('JSON quebrado é descartado', () => {
  assert.equal(interpretarResposta('desculpe, não consegui avaliar', 3), null);
  assert.equal(interpretarResposta('{"nota": 2,', 3), null);
  assert.equal(interpretarResposta('', 3), null);
  assert.equal(interpretarResposta(null, 3), null);
});

test('sugestão sem justificativa é descartada', () => {
  // Nota sem explicação não ajuda o professor a decidir — que é o ponto do requisito.
  assert.equal(interpretarResposta('{"nota": 2}', 3), null);
  assert.equal(interpretarResposta('{"nota": 2, "justificativa": "   "}', 3), null);
});

test('a nota é arredondada para duas casas', () => {
  assert.equal(interpretarResposta('{"nota": 1.666666, "justificativa": "Parcial."}', 3).nota, 1.67);
});

test('justificativa muito longa é cortada, não recusada', () => {
  const longa = 'a'.repeat(5000);
  const r = interpretarResposta(`{"nota": 1, "justificativa": "${longa}"}`, 3);
  assert.ok(r.justificativa.length <= 2000);
});

test('os limites 0 e a pontuação máxima são aceitos', () => {
  assert.equal(interpretarResposta('{"nota": 0, "justificativa": "Não respondeu ao pedido."}', 3).nota, 0);
  assert.equal(interpretarResposta('{"nota": 3, "justificativa": "Completa."}', 3).nota, 3);
});

// ------------------------------------------------------------- provedores

test('os três provedores pedidos estão disponíveis, mais o simulado', () => {
  assert.deepEqual(Object.keys(PROVEDORES).sort(), ['anthropic', 'gemini', 'openai', 'simulado']);
});

test('cada provedor real monta url, cabeçalhos e corpo', () => {
  for (const nome of ['openai', 'gemini', 'anthropic']) {
    const p = PROVEDORES[nome];
    const req = p.requisicao({ modelo: 'modelo-x', chave: 'chave-secreta', instrucao: 'i', mensagem: 'm' });
    assert.match(req.url, /^https:\/\//, `${nome}: url`);
    assert.ok(req.corpo, `${nome}: corpo`);
    // A chave precisa viajar de alguma forma — cabeçalho ou URL, conforme o serviço.
    const temChave = JSON.stringify(req.cabecalhos).includes('chave-secreta') || req.url.includes('chave-secreta');
    assert.ok(temChave, `${nome}: a chave precisa ser enviada`);
  }
});

test('o provedor simulado devolve nota dentro do intervalo e avisa que é simulação', () => {
  const r = PROVEDORES.simulado.simular({ resposta: 'uma resposta curta', pontuacaoMaxima: 5 });
  assert.ok(r.nota >= 0 && r.nota <= 5);
  assert.match(r.justificativa, /simulada/i);
});

test('o simulado não quebra com resposta vazia', () => {
  const r = PROVEDORES.simulado.simular({ resposta: '', pontuacaoMaxima: 2 });
  assert.equal(r.nota, 0);
});

// ------------------------------------------------------- trava de rede dos testes

test('nenhum teste consegue consultar um serviço externo', async () => {
  // A trava é instalada antes da suíte (tests/ajuda/sem-rede.js). Este teste existe para
  // que ela própria seja verificada: se alguém a remover, este caso falha.
  await assert.rejects(
    () => fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' }),
    /chamada de rede bloqueada/,
    'a trava precisa impedir qualquer chamada a serviço externo durante os testes',
  );
});
