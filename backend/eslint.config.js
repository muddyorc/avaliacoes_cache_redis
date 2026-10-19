// Análise estática do backend — ESLint.
//
// Análise estática é a verificação do código **sem executá-lo**: a ferramenta lê os
// arquivos, entende a estrutura e aponta o que é defeito em potencial — variável que
// nunca é usada, promessa esquecida sem `await`, comparação frouxa que compara tipos
// diferentes, atribuição dentro de um `if`.
//
// É complementar aos testes, não concorrente: o teste prova que o caminho exercitado
// funciona; a análise estática olha **todo** o código, inclusive o que nenhum teste
// percorreu.
//
// As regras abaixo foram escolhidas uma a uma, e não copiadas de um preset qualquer:
// cada uma precisa valer para este projeto e ser defensável.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module', // o projeto é ESM puro (type: module)
      globals: {
        ...globals.node, // process, console, Buffer, fetch…
      },
    },
    rules: {
      // ------------------------------------------------- defeitos prováveis
      // `require-await` fica DESLIGADA de propósito: o padrão do projeto é a função de
      // serviço ser `async` e devolver a promessa de `transacao(...)` ou `query(...)`.
      // Nesses casos não há await no corpo, e a regra acusaria dez funções corretas. A
      // falha que ela tenta pegar — chamada assíncrona sem await — só é detectável com
      // informação de tipos, que este projeto (JavaScript puro) não tem.
      'require-await': 'off',
      'no-return-await': 'error',
      // `==` compara tipos diferentes convertendo: '0' == 0 é verdadeiro. Em regra de
      // negócio sobre nota e pontuação, isso é risco real. A exceção é `x == null`, que
      // é o idioma consagrado para "nulo ou indefinido" e é usado deliberadamente.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'warn',
      // Atribuição dentro de condição quase sempre é `==` digitado errado.
      'no-cond-assign': ['error', 'always'],
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'warn',

      // ------------------------------------------------- código morto e sobras
      // `ignoreRestSiblings` permite o idioma de omitir uma propriedade:
      // `const { maxAge, ...resto } = opcoes` descarta `maxAge` de propósito.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-unused-private-class-members': 'error',
      'no-useless-rename': 'error',
      'no-useless-return': 'error',
      'no-lonely-if': 'warn',

      // ------------------------------------------------- segurança e boas práticas
      // `eval` e equivalentes executam texto como código: porta aberta para injeção.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      // Esquecer um console.log de depuração em produção vaza informação no log.
      'no-console': ['warn', { allow: ['error', 'warn', 'info', 'log'] }],

      // ------------------------------------------------- consistência
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'prefer-template': 'warn',
      'no-else-return': ['warn', { allowElseIf: false }],
    },
  },
  {
    // Nos testes, `console` é a saída esperada e funções sem await são comuns.
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    rules: {
      'no-console': 'off',
      'require-await': 'off',
    },
  },
];
