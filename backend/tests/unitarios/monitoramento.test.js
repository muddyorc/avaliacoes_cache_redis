// Testes UNITÁRIOS da regra que separa conduta de limitação técnica (RF10, P-25).
//
// É a regra que decide quais eventos podem encerrar a prova de alguém. Ela é curta, mas
// carrega uma decisão de projeto: o estudante não escolhe o navegador da escola, e por
// isso a ausência de um recurso de monitoramento nunca conta contra ele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTAM_PARA_O_LIMITE, TIPOS, contaParaOLimite } from '../../src/modules/monitoramento/monitoramento.service.js';

test('os eventos de conduta contam para o limite', () => {
  assert.equal(contaParaOLimite('PERDA_FOCO'), true);
  assert.equal(contaParaOLimite('TROCA_ABA'), true);
  assert.equal(contaParaOLimite('ATALHO'), true);
});

test('recurso indisponível no navegador NÃO conta (UC10 A5, P-25)', () => {
  // Bloquear por causa disso puniria a ferramenta, não a pessoa.
  assert.equal(contaParaOLimite('RECURSO_INDISPONIVEL'), false);
});

test('tipo desconhecido não conta', () => {
  assert.equal(contaParaOLimite('CAMERA_DESLIGADA'), false);
  assert.equal(contaParaOLimite(''), false);
  assert.equal(contaParaOLimite(undefined), false);
});

test('todo tipo que conta é um tipo aceito pelo sistema', () => {
  // Protege contra erro de digitação: um tipo na lista do limite que o banco recusaria
  // criaria uma regra que nunca dispara.
  for (const tipo of CONTAM_PARA_O_LIMITE) {
    assert.ok(TIPOS.includes(tipo), `${tipo} precisa estar entre os tipos aceitos`);
  }
});

// Os quatro tipos do DERS continuam previstos; o quinto nasceu em 18/10/2026 com a prova
// em tela cheia (migração 018). O que importa guardar aqui é a separação: só três
// contam para o limite, e o que foi acrescentado não encerra a prova de ninguém.
test('os tipos previstos, e quais deles contam para o limite', () => {
  assert.deepEqual(
    [...TIPOS].sort(),
    ['ATALHO', 'PERDA_FOCO', 'RECURSO_INDISPONIVEL', 'SAIU_TELA_CHEIA', 'TROCA_ABA'],
  );
  assert.deepEqual([...CONTAM_PARA_O_LIMITE].sort(), ['ATALHO', 'PERDA_FOCO', 'TROCA_ABA']);
  assert.equal(contaParaOLimite('SAIU_TELA_CHEIA'), false, 'sair da tela cheia não encerra a prova');
});
