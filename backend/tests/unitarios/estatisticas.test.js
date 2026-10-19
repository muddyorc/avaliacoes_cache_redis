// Testes UNITÁRIOS da aritmética de desempenho (RF12 e RF13).
//
// Não sobem a API nem tocam o banco: chamam a função com um valor e conferem o que ela
// devolve. É onde os casos de borda cabem — conjunto vazio, empate, divisão por zero,
// o 100% exato na última faixa — que nos testes de API custariam montar uma prova inteira
// para cada variação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAIXAS,
  arredondar,
  destaques,
  distribuirPorFaixa,
  faixaDe,
  indiceDeAcerto,
  percentualDe,
  resumoDasNotas,
} from '../../src/dominio/estatisticas.js';

// ------------------------------------------------------------------ arredondar

test('arredondar usa duas casas por padrão e aceita outra precisão', () => {
  assert.equal(arredondar(3.14159), 3.14);
  assert.equal(arredondar(3.14159, 1), 3.1);
  assert.equal(arredondar(2.555), 2.56);
  assert.equal(arredondar(10), 10);
});

test('arredondar devolve null para o que não é número', () => {
  assert.equal(arredondar(null), null);
  assert.equal(arredondar(undefined), null);
  assert.equal(arredondar('abc'), null);
});

// -------------------------------------------------------------- resumo das notas

test('o resumo traz média, mediana, menor e maior', () => {
  const r = resumoDasNotas([2, 8, 6, 4]);
  assert.equal(r.media, 5);
  assert.equal(r.mediana, 5, 'par: média dos dois centrais');
  assert.equal(r.menor, 2);
  assert.equal(r.maior, 8);
});

test('com quantidade ímpar, a mediana é o valor central', () => {
  assert.equal(resumoDasNotas([1, 9, 2]).mediana, 2);
});

test('a mediana não se deixa puxar por uma nota fora da curva', () => {
  // É por isso que o painel mostra as duas: a média cai para 2,2 e a mediana fica em 10.
  const r = resumoDasNotas([10, 10, 10, 10, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.mediana, 0);
  assert.notEqual(r.media, r.mediana);
});

test('sem notas o resumo é null, e não um monte de zeros', () => {
  // UC12 A2: "ainda não há dados" é diferente de "a turma tirou zero".
  assert.equal(resumoDasNotas([]), null);
  assert.equal(resumoDasNotas(null), null);
});

test('uma nota só é média, mediana, menor e maior ao mesmo tempo', () => {
  assert.deepEqual(resumoDasNotas([7]), { media: 7, mediana: 7, menor: 7, maior: 7 });
});

// ------------------------------------------------------------------- percentual

test('o percentual é arredondado a uma casa', () => {
  assert.equal(percentualDe(1, 3), 33.3);
  assert.equal(percentualDe(4, 8), 50);
});

test('sem total não há percentual — null, nunca zero', () => {
  assert.equal(percentualDe(5, 0), null);
  assert.equal(percentualDe(0, null), null);
});

// ------------------------------------------------------------------- faixas

test('cada percentual cai na sua faixa', () => {
  assert.equal(faixaDe(0), '0 a 20%');
  assert.equal(faixaDe(19.9), '0 a 20%');
  assert.equal(faixaDe(20), '20 a 40%', 'o limite pertence à faixa de cima');
  assert.equal(faixaDe(50), '40 a 60%');
  assert.equal(faixaDe(80), '80 a 100%');
});

test('o 100% entra na última faixa, que é fechada dos dois lados', () => {
  assert.equal(faixaDe(100), '80 a 100%');
});

test('percentual fora de 0 a 100 não pertence a faixa nenhuma', () => {
  assert.equal(faixaDe(101), null);
  assert.equal(faixaDe(-1), null);
  assert.equal(faixaDe(null), null);
});

test('a distribuição sempre traz as cinco faixas, inclusive as vazias', () => {
  const d = distribuirPorFaixa([10, 30, 100]);
  assert.equal(d.length, FAIXAS.length);
  assert.deepEqual(d.map((f) => f.total), [1, 1, 0, 0, 1]);
  // O gráfico precisa do eixo inteiro: faixa vazia é informação, não ausência.
  assert.equal(d[2].faixa, '40 a 60%');
});

test('sem provas, a distribuição é cinco faixas zeradas', () => {
  assert.deepEqual(distribuirPorFaixa([]).map((f) => f.total), [0, 0, 0, 0, 0]);
});

// ------------------------------------------------------------- índice de acerto

test('na objetiva o índice é a proporção de acertos', () => {
  assert.equal(indiceDeAcerto({ tipo: 'OBJETIVA', acertos: 3, totalProvas: 4 }), 75);
  assert.equal(indiceDeAcerto({ tipo: 'OBJETIVA', acertos: 0, totalProvas: 5 }), 0);
});

test('na discursiva o índice é a soma das notas sobre o total possível', () => {
  // Meio acerto conta como meio: 5 provas de 2 pontos, 5 pontos somados = 50%.
  assert.equal(indiceDeAcerto({ tipo: 'DISCURSIVA', somaNotas: 5, totalProvas: 5, pontuacao: 2 }), 50);
});

test('sem provas corrigidas não há índice', () => {
  assert.equal(indiceDeAcerto({ tipo: 'OBJETIVA', acertos: 0, totalProvas: 0 }), null);
});

test('discursiva valendo zero ponto não gera divisão por zero', () => {
  assert.equal(indiceDeAcerto({ tipo: 'DISCURSIVA', somaNotas: 0, totalProvas: 3, pontuacao: 0 }), null);
});

// ---------------------------------------------------------------- destaques

const questao = (id, indice) => ({ questaoId: id, ordem: id, indiceAcerto: indice });

test('os destaques vêm ordenados do melhor para o pior', () => {
  const { maioresAcertos, maioresErros } = destaques([
    questao(1, 10), questao(2, 90), questao(3, 50), questao(4, 70), questao(5, 30), questao(6, 100),
  ]);
  assert.deepEqual(maioresAcertos.map((q) => q.questaoId), [6, 2, 4]);
  assert.deepEqual(maioresErros.map((q) => q.questaoId), [1, 5, 3]);
});

test('DT60: a mesma questão nunca aparece nos dois lados', () => {
  // Numa prova de três questões, sem a regra as listas seriam a mesma, invertida.
  const { maioresAcertos, maioresErros } = destaques([questao(1, 90), questao(2, 50), questao(3, 10)]);
  assert.deepEqual(maioresAcertos.map((q) => q.questaoId), [1, 2, 3]);
  assert.deepEqual(maioresErros, [], 'não sobra nenhuma para o outro lado');
});

test('questão sem índice calculável fica fora dos dois destaques', () => {
  const { maioresAcertos, maioresErros } = destaques([
    questao(1, 80), questao(2, null), questao(3, 20), questao(4, undefined), questao(5, 40), questao(6, 60),
  ]);
  const todos = [...maioresAcertos, ...maioresErros].map((q) => q.questaoId);
  assert.ok(!todos.includes(2) && !todos.includes(4));
});

test('sem questões, os destaques são listas vazias', () => {
  assert.deepEqual(destaques([]), { maioresAcertos: [], maioresErros: [] });
  assert.deepEqual(destaques(undefined), { maioresAcertos: [], maioresErros: [] });
});

// P-26 — objetiva de múltipla escolha tem nota parcial, e o índice precisa enxergar isso.
test('objetiva de múltipla escolha usa a nota, não a contagem de acertos', () => {
  // Duas provas, questão de 4 pontos: uma tirou 4 (acerto integral) e outra tirou 2.
  // Pela contagem de acertos seriam 50%; pela nota, 75% — que é o desempenho real.
  const comum = { tipo: 'OBJETIVA', acertos: 1, totalProvas: 2, somaNotas: 6, pontuacao: 4 };
  assert.equal(indiceDeAcerto({ ...comum }), 50);
  assert.equal(indiceDeAcerto({ ...comum, multiplasCorretas: true }), 75);
});

test('múltipla escolha sem pontuação não tem índice, como a discursiva', () => {
  assert.equal(
    indiceDeAcerto({ tipo: 'OBJETIVA', multiplasCorretas: true, totalProvas: 3, somaNotas: 0, pontuacao: 0 }),
    null,
  );
});
