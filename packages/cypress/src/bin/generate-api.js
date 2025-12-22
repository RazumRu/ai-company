import { generateClient } from '../api-generator.js';

const [url, output] = process.argv.slice(2);

generateClient({ url, output })
  .then(() => {
    console.log('Client generated');
  })
  .catch(console.error);
