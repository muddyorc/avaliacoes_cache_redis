// Testes UNITÁRIOS do texto da interface.
//
// `primeiroNome` decide o cumprimento de toda tela inicial (DS-11). Já errou duas vezes
// na prática — "Olá, Prof." e "Olá, de" —, e os dois casos viraram teste aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primeiroNome } from '../src/utils/texto.js';

test('usa o primeiro nome de quem está na tela', () => {
  assert.equal(primeiroNome('Ana Ramos'), 'Ana');
  assert.equal(primeiroNome('Bruno'), 'Bruno');
});

test('o tratamento não é nome: "Prof. Rita" cumprimenta Rita', () => {
  assert.equal(primeiroNome('Prof. Rita Alves'), 'Rita');
  assert.equal(primeiroNome('Profa. Carla'), 'Carla');
  assert.equal(primeiroNome('Dr. Paulo Souza'), 'Paulo');
  assert.equal(primeiroNome('Sra. Helena'), 'Helena');
});

test('a preposição também não é nome: "Professor de Teste" não vira "de"', () => {
  // Defeito encontrado em 24/09/2026: a tela mostrava "Olá, de".
  assert.equal(primeiroNome('Professor de Teste'), 'Teste');
  assert.equal(primeiroNome('Maria da Silva'), 'Maria');
  assert.equal(primeiroNome('Prof. dos Santos Lima'), 'Santos');
});

test('quem só tem tratamento no cadastro é cumprimentado assim mesmo', () => {
  // Melhor um cumprimento formal do que um cumprimento vazio.
  assert.equal(primeiroNome('Professor'), 'Professor');
  assert.equal(primeiroNome('Dr.'), 'Dr.');
});

test('espaços sobrando e nome ausente não quebram a tela', () => {
  assert.equal(primeiroNome('   Ana   Ramos  '), 'Ana');
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(), '');
});
