import { generateClient } from '../api-generator.js';

let [url, output] = process.argv.slice(2);

generateClient({ url, output })
  .then(() => {
    console.log('Client generated');
  })
  .catch(console.error);
