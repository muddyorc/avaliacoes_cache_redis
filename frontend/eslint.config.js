// Análise estática da interface — ESLint com as regras de React.
//
// Além dos defeitos que valem para qualquer JavaScript, aqui entram as verificações
// específicas de React, e elas pegam uma classe de erro que teste nenhum pega com
// facilidade: dependência faltando em `useEffect` (a tela não atualiza quando deveria)
// e hook chamado dentro de condição (o React perde o rastro do estado).
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser, // window, document, fetch, localStorage…
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      // ------------------------------------------------------------ React
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules, // React 19 não exige importar React
      // Hook dentro de `if` ou laço quebra a ordem em que o React guarda o estado.
      'react-hooks/rules-of-hooks': 'error',
      // Dependência faltando em useEffect: a tela continua mostrando dado velho.
      'react-hooks/exhaustive-deps': 'warn',
      // Chave de lista pelo índice: ao remover um item, o React reaproveita o elemento
      // errado e o estado "gruda" na linha de baixo.
      'react/no-array-index-key': 'warn',
      'react/jsx-no-target-blank': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/jsx-key': 'error',
      // A validação de props por PropTypes não é usada neste projeto.
      'react/prop-types': 'off',

      // ------------------------------------------------- defeitos prováveis
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-cond-assign': ['error', 'always'],
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-unreachable-loop': 'error',
      'no-promise-executor-return': 'error',

      // ------------------------------------------------- código morto e sobras
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-useless-rename': 'error',
      'no-useless-return': 'error',

      // ------------------------------------------------- segurança
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // Inserir HTML cru abre caminho para XSS: se aparecer, tem de ser decisão
      // consciente, não descuido.
      'react/no-danger': 'error',
      // Alerta sobre `console` esquecido depois da depuração.
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // ------------------------------------------------- consistência
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'prefer-template': 'warn',
    },
  },
  {
    // A configuração do Vite roda no Node: usa `process.env`, não `window`.
    files: ['vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Os testes do frontend rodam no Node, não no navegador.
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
