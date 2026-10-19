// Pequenos ajustes de texto usados na interface.

// Tratamentos que não servem para cumprimentar: "Prof. Rita" deve virar "Rita".
const TRATAMENTOS = new Set(['prof', 'profa', 'professor', 'professora', 'dr', 'dra', 'sr', 'sra']);

// Partículas de sobrenome. Sem elas, "Professor de Teste" cumprimentaria "Olá, de" —
// tirado o tratamento, o que sobra na frente é a preposição, não o nome.
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'del', 'di', 'van', 'von']);

// O primeiro nome de quem está na tela. Se sobrar nada depois de tirar o tratamento
// (alguém cadastrado só como "Professor"), devolve o nome como veio — melhor um nome
// formal do que um cumprimento vazio.
export function primeiroNome(nome = '') {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const util = partes.find((parte) => {
    const limpa = parte.replace(/\.$/, '').toLowerCase();
    return !TRATAMENTOS.has(limpa) && !PARTICULAS.has(limpa);
  });
  return util ?? nome.trim();
}
