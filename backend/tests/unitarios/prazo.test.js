// Testes UNITÁRIOS do prazo da prova (DT06, UC08).
//
// É a regra que decide quando a prova de alguém acaba. Aqui ela é conferida direto, com
// datas fixas — sem esperar cronômetro e sem subir a API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prazoFinalDaProva, prazoVencido, tempoRestante } from '../../src/dominio/prazo.js';

const em = (texto) => new Date(texto);

test('com período longo, vale a duração da prova', () => {
  const prazo = prazoFinalDaProva(em('2026-09-26T10:00:00Z'), 60, em('2026-09-26T23:00:00Z'));
  assert.equal(prazo.toISOString(), '2026-09-26T11:00:00.000Z');
});

test('começando perto do fim do período, vale o fim do período', () => {
  // Quem inicia faltando dez minutos tem dez minutos, não a hora inteira: é o que impede
  // começar no último minuto para ganhar tempo além do prazo da avaliação.
  const prazo = prazoFinalDaProva(em('2026-09-26T22:50:00Z'), 60, em('2026-09-26T23:00:00Z'));
  assert.equal(prazo.toISOString(), '2026-09-26T23:00:00.000Z');
});

test('quando os dois coincidem, o prazo é esse instante', () => {
  const prazo = prazoFinalDaProva(em('2026-09-26T22:00:00Z'), 60, em('2026-09-26T23:00:00Z'));
  assert.equal(prazo.toISOString(), '2026-09-26T23:00:00.000Z');
});

test('o período já encerrado não devolve prazo no futuro', () => {
  const prazo = prazoFinalDaProva(em('2026-09-26T23:30:00Z'), 60, em('2026-09-26T23:00:00Z'));
  assert.ok(prazo <= em('2026-09-26T23:00:00Z'));
});

test('a duração conta em minutos, não em outra unidade', () => {
  const prazo = prazoFinalDaProva(em('2026-09-26T10:00:00Z'), 90, em('2026-09-27T00:00:00Z'));
  assert.equal(prazo.toISOString(), '2026-09-26T11:30:00.000Z');
});

test('o tempo restante nunca é negativo', () => {
  assert.equal(tempoRestante(em('2026-09-26T10:00:00Z'), em('2026-09-26T10:10:00Z')), 600000);
  assert.equal(tempoRestante(em('2026-09-26T11:00:00Z'), em('2026-09-26T10:10:00Z')), 0);
});

test('no instante exato do prazo, a prova já acabou', () => {
  const prazo = em('2026-09-26T11:00:00Z');
  assert.equal(prazoVencido(em('2026-09-26T10:59:59Z'), prazo), false);
  assert.equal(prazoVencido(prazo, prazo), true);
  assert.equal(prazoVencido(em('2026-09-26T11:00:01Z'), prazo), true);
});
