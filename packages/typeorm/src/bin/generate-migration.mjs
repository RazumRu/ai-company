import { exec } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const dir = dirname(filename);

exec(
  `node ${dir}/../scripts/migration.mjs generate ${process.argv
    .slice(2)
    .join(' ')}`.trim(),
  (err, out, errOut) => {
    console.log(err, out, errOut);
  },
);
