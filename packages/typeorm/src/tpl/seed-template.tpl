import dataSource from '../typeormconfig';

const dataset = [];

(async () => {
  await dataSource.initialize();

  //await dataSource.manager.insert(TransactionsEntity, dataset);
  await dataSource.destroy();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
