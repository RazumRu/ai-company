import { generateClient } from '../index';

let [url, output] = process.argv.slice(2);

generateClient({ url, output })
  .then(() => {
    console.log('Client generated');
  })
  .catch(console.error);
