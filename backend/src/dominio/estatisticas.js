// Cálculos de desempenho — o núcleo aritmético do RF12 e do RF13.
//
// Vive fora dos serviços de propósito: aqui não há banco, requisição nem sessão, só
// entrada e saída. Isso permite testá-lo unitariamente (sem PostgreSQL) e, principalmente,
// garante que o professor e o estudante leiam **o mesmo número** — antes, a média, as
// faixas e os destaques estavam escritos duas vezes, em lugares diferentes, e a regra dos
// destaques chegou a divergir entre o painel do professor (aplicada na tela) e o resultado
// do estudante (aplicada no servidor).
//
// Nada aqui conhece nomes de estudante: os agregados são anônimos por construção (P-23).

// Arredonda para uso em tela. Duas casas por padrão: pontuação usa NUMERIC(8,2) no banco.
export function arredondar(valor, casas = 2) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return null;
  const fator = 10 ** casas;
  return Math.round(Number(valor) * fator) / fator;
}

// Faixas de 20% do gráfico de distribuição. A última é fechada nos dois lados para o
// 100% não ficar de fora.
export const FAIXAS = [
  { rotulo: '0 a 20%', min: 0, max: 20 },
  { rotulo: '20 a 40%', min: 20, max: 40 },
  { rotulo: '40 a 60%', min: 40, max: 60 },
  { rotulo: '60 a 80%', min: 60, max: 80 },
  { rotulo: '80 a 100%', min: 80, max: 100 },
];

const ULTIMA = FAIXAS.length - 1;

const dentroDaFaixa = (percentual, faixa, indice) =>
  percentual >= faixa.min && (indice === ULTIMA ? percentual <= faixa.max : percentual < faixa.max);

// Em que faixa cai um percentual. Fora de 0–100 não pertence a faixa nenhuma.
export function faixaDe(percentual) {
  if (percentual === null || percentual === undefined) return null;
  return FAIXAS.find((faixa, i) => dentroDaFaixa(percentual, faixa, i))?.rotulo ?? null;
}

// Quantas provas caíram em cada faixa. Sempre devolve as cinco faixas, inclusive as
// vazias: o gráfico precisa do eixo inteiro, e "nenhuma prova nesta faixa" é informação.
export function distribuirPorFaixa(percentuais) {
  return FAIXAS.map((faixa, i) => ({
    faixa: faixa.rotulo,
    total: percentuais.filter((p) => dentroDaFaixa(p, faixa, i)).length,
  }));
}

// Percentual de `parte` sobre `total`. Sem total não há percentual — devolver 0 diria
// "zerou", que é coisa diferente de "não dá para calcular" (UC12 A2).
export function percentualDe(parte, total) {
  if (!total || total <= 0) return null;
  return arredondar((Number(parte) / Number(total)) * 100, 1);
}

// Média, mediana, menor e maior de um conjunto de notas.
// Sem notas, devolve null: o painel mostra "ainda não há dados" em vez de zeros.
export function resumoDasNotas(notas) {
  if (!Array.isArray(notas) || notas.length === 0) return null;
  const ordenadas = [...notas].map(Number).sort((a, b) => a - b);
  const soma = ordenadas.reduce((total, n) => total + n, 0);
  const meio = Math.floor(ordenadas.length / 2);
  return {
    media: arredondar(soma / ordenadas.length),
    // A mediana ajuda quando uma nota muito fora da curva puxa a média.
    mediana: arredondar(ordenadas.length % 2 ? ordenadas[meio] : (ordenadas[meio - 1] + ordenadas[meio]) / 2),
    menor: arredondar(ordenadas[0]),
    maior: arredondar(ordenadas[ordenadas.length - 1]),
  };
}

// Aproveitamento da turma numa questão, em percentual.
//
// Objetiva é proporção de acertos; discursiva é a soma das notas sobre o total possível —
// meio acerto numa discursiva conta como meio, e não como erro. Sem provas corrigidas, ou
// com questão de pontuação zero, não há índice: null, nunca 0.
export function indiceDeAcerto({
  tipo,
  acertos = 0,
  totalProvas = 0,
  somaNotas = 0,
  pontuacao = 0,
  multiplasCorretas = false,
}) {
  if (!totalProvas || totalProvas <= 0) return null;
  // Objetiva de resposta única é acerto ou erro, e a proporção de acertos basta.
  // A de múltipla escolha tem nota parcial (P-26): contar só o acerto integral faria a
  // questão parecer mais difícil do que foi, e quem acertou metade entraria como quem não
  // acertou nada. Ela usa a mesma conta da discursiva, pela mesma razão.
  if (tipo === 'OBJETIVA' && !multiplasCorretas) {
    return arredondar((Number(acertos) / totalProvas) * 100, 1);
  }
  if (!pontuacao || Number(pontuacao) <= 0) return null;
  return arredondar((Number(somaNotas) / (totalProvas * Number(pontuacao))) * 100, 1);
}

// As questões em que a turma foi melhor e aquelas em que teve mais dificuldade.
//
// A mesma questão nunca aparece nos dois lados: numa prova curta, as listas seriam a mesma
// invertida e sugeririam um contraste que não existe (DT60). Questão sem índice calculável
// fica de fora das duas.
export function destaques(questoes, quantidade = 3) {
  const comIndice = (questoes ?? []).filter((q) => q.indiceAcerto !== null && q.indiceAcerto !== undefined);
  const porIndice = [...comIndice].sort((a, b) => b.indiceAcerto - a.indiceAcerto);

  const maioresAcertos = porIndice.slice(0, quantidade);
  const noTopo = new Set(maioresAcertos.map((q) => q.questaoId));
  const maioresErros = [...porIndice].reverse().filter((q) => !noTopo.has(q.questaoId)).slice(0, quantidade);

  return { maioresAcertos, maioresErros };
}
