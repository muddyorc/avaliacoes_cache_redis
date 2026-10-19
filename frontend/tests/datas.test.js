// Testes UNITÁRIOS das conversões de data, hora e pontuação da interface.
//
// A API fala ISO-8601 em UTC; o campo <input type="datetime-local"> fala horário local
// sem fuso. A conversão entre os dois é onde nascem erros de "a prova abriu três horas
// antes do que eu marquei", então ela é conferida aqui, isolada da tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deCampoLocal,
  formatarDuracao,
  formatarPontos,
  paraCampoLocal,
  urgenciaDoPrazo,
} from '../src/utils/datas.js';

// ---------------------------------------------------- ida e volta com o formulário

test('ida e volta entre a API e o campo preserva o instante', () => {
  const iso = '2026-10-01T14:30:00.000Z';
  const voltou = deCampoLocal(paraCampoLocal(iso));
  assert.equal(new Date(voltou).getTime(), new Date(iso).getTime());
});

test('o campo recebe o formato que o navegador espera, sem segundos nem fuso', () => {
  assert.match(paraCampoLocal('2026-10-01T14:30:00.000Z'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('campo vazio continua vazio nos dois sentidos', () => {
  assert.equal(paraCampoLocal(''), '');
  assert.equal(paraCampoLocal(null), '');
  assert.equal(deCampoLocal(''), '');
  assert.equal(deCampoLocal(null), '');
});

test('data digitada de forma inválida não vira "Invalid Date" no corpo da requisição', () => {
  assert.equal(deCampoLocal('não é data'), '');
  assert.equal(deCampoLocal('2026-13-45T99:99'), '');
});

// ------------------------------------------------------------------- duração

test('a duração aparece como cronômetro, sempre em minutos', () => {
  assert.equal(formatarDuracao(45), '45:00');
  assert.equal(formatarDuracao(60), '60:00');
  assert.equal(formatarDuracao(90), '90:00');
  assert.equal(formatarDuracao(125), '125:00');
});

test('a duração não transborda para horas', () => {
  assert.equal(formatarDuracao(120), '120:00');
  assert.equal(formatarDuracao(480), '480:00');
});

test('duração de um dígito ganha o zero à esquerda do relógio', () => {
  assert.equal(formatarDuracao(5), '05:00');
});

// ------------------------------------------------------------------- urgência

// A regra que estes testes guardam: o nível é o que pinta a cor na tela, então ele não
// pode mudar de faixa por engano. E o texto tem de ser verdadeiro sozinho — é ele que
// informa quem não distingue as cores.

const AGORA = new Date('2026-10-18T10:00:00');
const daqui = (minutos) => new Date(AGORA.getTime() + minutos * 60000);

test('faltando horas, o prazo é crítico e diz quanto falta', () => {
  assert.deepEqual(urgenciaDoPrazo(daqui(40), AGORA), { nivel: 'critico', texto: 'Vence em 40 minutos' });
  assert.deepEqual(urgenciaDoPrazo(daqui(60), AGORA), { nivel: 'critico', texto: 'Vence em 1 hora' });
  assert.deepEqual(urgenciaDoPrazo(daqui(180), AGORA), { nivel: 'critico', texto: 'Vence em 3 horas' });
});

test('os minutos quebrados aparecem, em vez de sumirem no truncamento', () => {
  // O caso que o autor pegou na tela: 10:32 para um prazo das 12:23.
  assert.deepEqual(urgenciaDoPrazo(daqui(111), AGORA), {
    nivel: 'critico',
    texto: 'Vence em 1 hora e 51 minutos',
  });
  assert.deepEqual(urgenciaDoPrazo(daqui(121), AGORA), {
    nivel: 'critico',
    texto: 'Vence em 2 horas e 1 minuto',
  });
  // Trunca para baixo: faltando 1 h 59, ainda é "1 hora e 59 minutos", nunca "2 horas".
  assert.match(urgenciaDoPrazo(daqui(119), AGORA).texto, /^Vence em 1 hora e 59 minutos$/);
});

test('vencer no mesmo dia é crítico, mesmo faltando mais de seis horas', () => {
  // 22:00 do mesmo dia: doze horas pela frente, mas acaba hoje.
  assert.deepEqual(urgenciaDoPrazo(new Date('2026-10-18T22:00:00'), AGORA), {
    nivel: 'critico',
    texto: 'Vence hoje, às 22:00',
  });
});

test('amanhã e a semana ficam em atenção', () => {
  assert.deepEqual(urgenciaDoPrazo(new Date('2026-10-19T08:00:00'), AGORA), {
    nivel: 'atencao',
    texto: 'Vence amanhã, às 08:00',
  });
  assert.deepEqual(urgenciaDoPrazo(new Date('2026-10-22T08:00:00'), AGORA), {
    nivel: 'atencao',
    texto: 'Faltam 4 dias',
  });
});

test('prazo folgado não ganha destaque', () => {
  assert.equal(urgenciaDoPrazo(new Date('2026-11-01T10:00:00'), AGORA).nivel, 'normal');
});

test('o dia vira pelo calendário, e não por 24 horas corridas', () => {
  // Às 23h, uma prova das 8h da manhã seguinte vence AMANHÃ — não "em 9 horas".
  const tarde = new Date('2026-10-18T23:00:00');
  assert.deepEqual(urgenciaDoPrazo(new Date('2026-10-19T08:00:00'), tarde), {
    nivel: 'atencao',
    texto: 'Vence amanhã, às 08:00',
  });
});

test('prazo já vencido não vira número negativo', () => {
  assert.deepEqual(urgenciaDoPrazo(daqui(-30), AGORA), { nivel: 'critico', texto: 'Prazo encerrado' });
});

// ------------------------------------------------------------------- pontuação

test('a pontuação concorda em número: 1 ponto, 2 pontos', () => {
  assert.equal(formatarPontos(1), '1 ponto');
  assert.equal(formatarPontos(2), '2 pontos');
  assert.equal(formatarPontos(0), '0 pontos');
});

test('nota fracionada usa vírgula, como se escreve em português', () => {
  assert.equal(formatarPontos(1.5), '1,5 pontos');
  assert.equal(formatarPontos(2.25), '2,25 pontos');
});
