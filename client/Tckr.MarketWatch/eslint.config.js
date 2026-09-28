// ESLint flat config. The `no-restricted-imports` blocks below encode the architecture
// rules in GUIDELINES.md §Architecture so a violation shows up in the editor, not only
// when the grep-style tests run (`shell.no-data-import.test.ts`, `gsap.lazy-chunk.test.ts`).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const concreteSources = {
  group: [
    '**/SimulatedSource',
    '**/SimulatedSource.ts',
    '**/TckrGatewaySource',
    '**/TckrGatewaySource.ts',
  ],
  message:
    'Only src/data/config.ts names a concrete source. Use getSharedSource()/createMarketDataSource() (GUIDELINES.md §Architecture).',
};
const gsapStatic = {
  group: ['gsap', 'gsap/*', '@gsap/*'],
  allowTypeImports: true,
  message:
    'GSAP is lazy-loaded: only src/motion/gsap.ts imports it. Use loadMotion()/useMotion() from src/motion/motion.ts.',
};
const uplotStatic = {
  group: ['uplot', 'uplot/*'],
  allowTypeImports: true,
  message: 'uplot stays in the lazy StockDetail chunk: only src/chart/** may import it.',
};

export default defineConfig([
  globalIgnores([
    'dist/',
    'node_modules/',
    'perf/raw/',
    'coverage/',
    '.claude/',
    '.impeccable/',
    '.playwright-mcp/',
  ]),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `import('…').X` annotations are how the lazy chunks are typed without a static import.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      // `async` on MarketDataSource implementations turns a synchronous throw into a rejection.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      // React Compiler rules. The app does not use the compiler, and the hot price path
      // deliberately reads/writes refs and the clock during render (PriceCell, RollingText,
      // the board re-rank). Revisit together if the compiler is adopted (GUIDELINES.md §3).
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // Architecture boundaries, outermost first; later blocks override `no-restricted-imports`
  // for the one place each import is allowed.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [concreteSources, gsapStatic, uplotStatic] }],
    },
  },
  {
    files: ['src/data/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [gsapStatic, uplotStatic] }] },
  },
  {
    files: ['src/motion/gsap.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [concreteSources, uplotStatic] }] },
  },
  {
    files: ['src/chart/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [concreteSources, gsapStatic] }] },
  },
  {
    files: ['src/App.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            concreteSources,
            gsapStatic,
            uplotStatic,
            {
              group: ['./data/*', '../data/*'],
              message: 'App.tsx never imports src/data (composition root is main.tsx).',
            },
          ],
        },
      ],
    },
  },

  // Tests reach into internals and mock freely.
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/test-support/**/*.{ts,tsx}', 'perf/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'react-hooks/globals': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
]);
