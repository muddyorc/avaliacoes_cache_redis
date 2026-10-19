// Testes UNITÁRIOS da detecção de atalhos monitorados (RF10, UC10 A3).
//
// É a regra que decide se uma tecla pressionada durante a prova vira ocorrência — e, com
// limite configurado, pode encerrar a avaliação de alguém. Errar para mais registra quem
// não fez nada; errar para menos deixa passar o que deveria constar. Por isso ela é
// conferida direto, tecla a tecla, sem precisar abrir o navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atalhoMonitorado } from '../src/utils/monitoramento.js';

// Monta um evento de teclado como o navegador entregaria.
const tecla = (key, { ctrl = false, shift = false, meta = false } = {}) => ({
  key,
  ctrlKey: ctrl,
  shiftKey: shift,
  metaKey: meta,
});

test('reconhece os atalhos de copiar, colar e recortar', () => {
  assert.equal(atalhoMonitorado(tecla('c', { ctrl: true }))?.nome, 'Ctrl+C');
  assert.equal(atalhoMonitorado(tecla('v', { ctrl: true }))?.nome, 'Ctrl+V');
  assert.equal(atalhoMonitorado(tecla('x', { ctrl: true }))?.nome, 'Ctrl+X');
});

test('reconhece imprimir e abrir nova aba ou janela', () => {
  assert.equal(atalhoMonitorado(tecla('p', { ctrl: true }))?.nome, 'Ctrl+P');
  assert.equal(atalhoMonitorado(tecla('t', { ctrl: true }))?.nome, 'Ctrl+T');
  assert.equal(atalhoMonitorado(tecla('n', { ctrl: true }))?.nome, 'Ctrl+N');
});

test('reconhece as ferramentas do desenvolvedor', () => {
  assert.equal(atalhoMonitorado(tecla('F12'))?.nome, 'F12');
  assert.equal(atalhoMonitorado(tecla('i', { ctrl: true, shift: true }))?.nome, 'Ctrl+Shift+I');
  assert.equal(atalhoMonitorado(tecla('j', { ctrl: true, shift: true }))?.nome, 'Ctrl+Shift+J');
});

test('a tecla Command do macOS vale como Ctrl', () => {
  // Sem isso, o monitoramento simplesmente não existiria para quem usa Mac.
  assert.equal(atalhoMonitorado(tecla('c', { meta: true }))?.nome, 'Ctrl+C');
  assert.equal(atalhoMonitorado(tecla('v', { meta: true }))?.nome, 'Ctrl+V');
});

test('maiúscula e minúscula são a mesma tecla', () => {
  // Com Caps Lock ligado o navegador entrega 'C'; continua sendo copiar.
  assert.equal(atalhoMonitorado(tecla('C', { ctrl: true }))?.nome, 'Ctrl+C');
  assert.equal(atalhoMonitorado(tecla('f12'))?.nome, 'F12');
});

test('letra sozinha não é atalho — digitar a resposta não gera ocorrência', () => {
  // O caso mais importante da lista: uma discursiva tem centenas de teclas digitadas.
  for (const letra of ['c', 'v', 'x', 'p', 't', 'n', 'a', 'i', 'j']) {
    assert.equal(atalhoMonitorado(tecla(letra)), undefined, `a tecla ${letra} sozinha não é atalho`);
  }
});

test('combinação parecida não é confundida com a monitorada', () => {
  // Ctrl+Shift+C é outro evento, e não pode ser contado como Ctrl+C.
  assert.equal(atalhoMonitorado(tecla('c', { ctrl: true, shift: true }))?.nome, 'Ctrl+Shift+C');
  // Shift+C é só uma letra maiúscula sendo digitada.
  assert.equal(atalhoMonitorado(tecla('c', { shift: true })), undefined);
  // Ctrl+Shift+P não está na lista; não vira ocorrência.
  assert.equal(atalhoMonitorado(tecla('p', { ctrl: true, shift: true })), undefined);
});

test('teclas de navegação e edição comuns não geram ocorrência', () => {
  for (const key of ['Tab', 'Enter', 'Backspace', 'ArrowLeft', 'Shift', 'Control', ' ']) {
    assert.equal(atalhoMonitorado(tecla(key)), undefined, `${key} não deveria ser monitorada`);
  }
});

test('evento sem tecla não quebra a detecção', () => {
  // Alguns navegadores entregam eventos sintéticos sem `key`.
  assert.equal(atalhoMonitorado({ ctrlKey: true, shiftKey: false, metaKey: false }), undefined);
  assert.equal(atalhoMonitorado(tecla(undefined, { ctrl: true })), undefined);
});
