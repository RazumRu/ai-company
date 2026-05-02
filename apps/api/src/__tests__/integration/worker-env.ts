/**
 * Side-effect module: rewrites `POSTGRES_URL` to the per-worker database name
 * and assigns a per-process BullMQ queue suffix before any other module reads
 * `process.env`.
 *
 * Imported at the top of `setup.ts` (must come before any import that
 * transitively pulls `environments`/`mikro-orm.config` or any BullMQ queue
 * service). Each vitest worker gets a unique slot in
 * `INTEGRATION_WORKER_DB_NAMES` keyed by `VITEST_POOL_ID`. Falls back to the
 * base DB if pool ID is absent or worker names weren't seeded by
 * `globalSetup` (e.g. running an .int.ts file via the base monorepo
 * `vitest.config.ts` instead of the api project config).
 *
 * BullMQ queues are shared via Redis across processes by name. Without a
 * per-process suffix, jobs queued by test file A stay in Redis and get
 * picked up by test file B's worker, then fail because file A's graph was
 * already cleaned up. The suffix isolates each test process.
 */
if (!process.env.BULLMQ_QUEUE_SUFFIX) {
  const poolId = process.env.VITEST_POOL_ID ?? '';
  process.env.BULLMQ_QUEUE_SUFFIX = `-test-${process.pid}${poolId ? `-p${poolId}` : ''}`;
}

const baseUrl =
  process.env.INTEGRATION_BASE_POSTGRES_URL ?? process.env.POSTGRES_URL;
if (baseUrl) {
  const namesEnv = process.env.INTEGRATION_WORKER_DB_NAMES;
  const poolIdRaw = process.env.VITEST_POOL_ID;
  if (namesEnv && poolIdRaw) {
    const names = namesEnv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const poolId = Number(poolIdRaw);
    if (Number.isFinite(poolId) && names.length > 0) {
      // VITEST_POOL_ID starts at 1; map onto worker DBs round-robin so
      // pools that exceed the provisioned worker count still get *a*
      // worker DB rather than colliding on the base.
      const index = (Math.max(1, Math.floor(poolId)) - 1) % names.length;
      const dbName = names[index];
      const url = new URL(baseUrl);
      url.pathname = `/${dbName}`;
      process.env.POSTGRES_URL = url.toString();
    }
  }
}
