import { exec } from 'child_process';
import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const dir = dirname(filename);
const EXECUTION_PATH = process.cwd();

const MODULE_PATH = `${process.argv[3]}`.trim();
const SEED_PATH = `${EXECUTION_PATH}/${MODULE_PATH}/seeds`;
const ACTION = process.argv[2];
const SEED_NAME = process.argv[4];

if (ACTION === 'create') {
  const tpl = fs.readFileSync(`${dir}/../tpl/seed-template.tpl`);
  const SEED_FILE_PATH = `${SEED_PATH}/${Date.now()}-${SEED_NAME}.ts`;

  fs.writeFileSync(SEED_FILE_PATH, tpl);

  console.log(`✅ Created seed: ${SEED_FILE_PATH}`);
}

if (ACTION === 'run') {
  const files = fs.readdirSync(SEED_PATH).filter((f) => f.endsWith('.ts'));

  files.sort();

  for (const file of files) {
    const fullPath = join(SEED_PATH, file);
    const cmd = `pnpm ts-node ${fullPath}`;

    console.log(`🚀 Running ${file}`, cmd);

    try {
      await new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
          if (err) {
            console.error(`❌ Error running ${file}:\n`, stderr);
            reject(err);
          } else {
            console.log(`✅ Finished ${file}:\n`, stdout);
            resolve();
          }
        });
      });
    } catch (error) {
      process.exit(1);
    }
  }
}
