import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { crypto: 'readonly', fetch: 'readonly', URL: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'off'
    }
  }
);
