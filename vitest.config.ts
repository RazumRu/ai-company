import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, mergeConfig } from 'vitest/config';

export const defineBaseConfig = () => ({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});

export default mergeConfig(
  defineBaseConfig(),
  defineConfig({
    test: {
      globals: true,
      silent: false,
      disableConsoleIntercept: true,
      projects: ['packages/*', 'apps/*'],
      coverage: {
        enabled: false,
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        all: true,
        clean: true,
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/generated/**'],
        thresholds: {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
      },
      environment: 'node',
    },
  }),
);
