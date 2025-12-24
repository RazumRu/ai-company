import { defineProject, mergeConfig } from 'vitest/config';

import { defineBaseConfig } from '../../vitest.config';
import pkg from './package.json';

export default mergeConfig(
  defineBaseConfig(),
  defineProject({
    test: {
      name: pkg.name,
      disableConsoleIntercept: true,
      include: ['src/**/*.spec.ts', 'src/**/*.int.ts'],
      projects: undefined,
    },
  }),
);
