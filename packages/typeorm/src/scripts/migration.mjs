import { exec } from 'child_process';

const MODULE_PATH = `${process.argv[3]}`;
const CONFIG_PATH = `${MODULE_PATH}/typeormconfig.ts`;
const MIGRATION_PATH = `${MODULE_PATH}/migrations/`;
const ACTION = process.argv[2];
const MIGRATION_NAME = process.argv[4] || `generated`;

let cmd;

switch (ACTION) {
  case 'create':
    cmd = `NODE_ENV=development pnpm typeorm-ts-node-commonjs migration:create ${MIGRATION_PATH}${MIGRATION_NAME}`;
    break;

  case 'generate':
    cmd = `NODE_ENV=development pnpm typeorm-ts-node-commonjs migration:generate ${MIGRATION_PATH}${MIGRATION_NAME} -d ${CONFIG_PATH} -p`;
    break;

  case 'run':
    cmd = `NODE_ENV=development pnpm typeorm-ts-node-commonjs migration:run -d ${CONFIG_PATH}`;
    break;

  case 'revert':
    cmd = `NODE_ENV=development pnpm typeorm-ts-node-commonjs migration:revert -d ${CONFIG_PATH}`;
    break;
}

if (!cmd) {
  throw new Error('Invalid action');
}

console.log(cmd);
exec(cmd, (err, out, errOut) => {
  console.log(out, errOut);
});
