import { defineProject, mergeConfig } from 'vitest/config';

import { defineBaseConfig } from '../../vitest.config';
import pkg from './package.json';

export default mergeConfig(
  defineBaseConfig(),
  defineProject({
    test: {
      name: pkg.name,
      include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
      environment: 'node',
    },
  }),
);
