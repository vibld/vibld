import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },
];
