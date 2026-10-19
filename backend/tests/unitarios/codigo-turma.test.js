// Testes UNITÁRIOS do código de acesso da turma (RF06, UC06 A2).
//
// O código é digitado por pessoas, a partir de um quadro ou de um papel. A normalização
// é o que permite aceitar "abcd-1234", "ABCD 1234" e "abcd1234" como o mesmo código, sem
// abrir mão de comparar com o que está gravado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarCodigo, normalizarCodigo } from '../../src/modules/turmas/turmas.service.js';

test('a normalização sobe para maiúsculas', () => {
  assert.equal(normalizarCodigo('abcd1234'), 'ABCD1234');
});

test('espaços e hífens digitados são ignorados', () => {
  assert.equal(normalizarCodigo('ABCD-1234'), 'ABCD1234');
  assert.equal(normalizarCodigo(' abcd 1234 '), 'ABCD1234');
  assert.equal(normalizarCodigo('a b c d 1 2 3 4'), 'ABCD1234');
});

test('pontuação e acentos são descartados, não confundidos com letras', () => {
  assert.equal(normalizarCodigo('ABCD.1234!'), 'ABCD1234');
  assert.equal(normalizarCodigo('ÁBCD1234'), 'BCD1234', 'acento não vira letra sem acento');
});

test('entrada vazia ou ausente não quebra a normalização', () => {
  assert.equal(normalizarCodigo(''), '');
  assert.equal(normalizarCodigo(null), '');
  assert.equal(normalizarCodigo(undefined), '');
});

test('o código gerado tem oito caracteres do alfabeto permitido', () => {
  for (let i = 0; i < 50; i += 1) {
    const codigo = gerarCodigo();
    assert.equal(codigo.length, 8);
    assert.match(codigo, /^[A-Z0-9]{8}$/);
    // Normalizar o que foi gerado não muda nada: o gerador já produz a forma canônica.
    assert.equal(normalizarCodigo(codigo), codigo);
  }
});

test('o alfabeto evita os caracteres que se confundem ao ler', () => {
  // Um código lido de um quadro não pode depender de distinguir O de 0, ou I de 1.
  const amostra = Array.from({ length: 200 }, gerarCodigo).join('');
  for (const confuso of ['O', '0', 'I', '1']) {
    assert.ok(!amostra.includes(confuso), `o caractere ${confuso} não deveria ser usado`);
  }
});
