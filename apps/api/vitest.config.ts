import { defineProject, mergeConfig } from 'vitest/config';

import { defineBaseConfig } from '../../vitest.config';
import pkg from './package.json';

const workerCount = Number(process.env.INTEGRATION_WORKER_COUNT ?? '4');
const fileParallelism = workerCount > 1;

export default mergeConfig(
  defineBaseConfig(),
  defineProject({
    test: {
      name: pkg.name,
      disableConsoleIntercept: true,
      include: ['src/**/*.spec.ts', 'src/**/*.int.ts'],
      projects: undefined,
      fileParallelism,
      maxWorkers: workerCount,
      globalSetup: ['./src/__tests__/integration/global-setup.ts'],
    },
  }),
);
