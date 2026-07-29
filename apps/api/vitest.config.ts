import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Carrega o .env da raiz do monorepo para os testes (inclusive e2e contra o Postgres).
loadEnv({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    root: './',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  plugins: [
    // Compila decorators do Nest para os testes.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
