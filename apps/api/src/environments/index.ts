import * as dotenv from 'dotenv';

dotenv.config();

import { environment as dev } from './environment.dev';
import { environment as prod } from './environment.prod';
import { environment as test } from './environment.test';

const ENV_MAP = {
  test: test(),
  development: dev(),
  production: prod(),
};
const NODE_ENV: keyof typeof ENV_MAP = <keyof typeof ENV_MAP>(
  String(process.env.NODE_ENV || 'production')
);

export const environment = ENV_MAP[NODE_ENV];
