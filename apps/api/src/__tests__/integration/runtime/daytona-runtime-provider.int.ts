import { INestApplication } from '@nestjs/common';
import { Daytona } from '@daytonaio/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { RuntimeInstanceDao } from '../../../v1/runtime/dao/runtime-instance.dao';
import {
  RuntimeInstanceStatus,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { createTestModule } from '../setup';

/**
 * Integration tests for RuntimeProvider with Daytona backend.
 *
 * These tests exercise the full provide() -> DB row -> cleanup flow
 * through the NestJS DI container with a real database and Daytona API.
 *
 * Required environment:
 *  - DAYTONA_API_KEY
 *  - DAYTONA_API_URL
 *  - A running PostgreSQL database
 */

const SANDBOX_IMAGE = 'daytonaio/sandbox:0.5.0-slim';
const TEST_NODE_ID = `runtime-node-provider-${Date.now()}`;
const TEST_GRAPH_ID = '00000000-0000-0000-0000-000000000099';
const TEST_THREAD_ID = `provider-thread-${Date.now()}`;
const RUNTIME_START_PARAMS = { image: SANDBOX_IMAGE };

describe('RuntimeProvider Daytona Integration', () => {
  let app: INestApplication;
  let runtimeProvider: RuntimeProvider;
  let runtimeInstanceDao: RuntimeInstanceDao;
  let containerName: string | undefined;

  beforeAll(async () => {
    const apiKey = environment.daytonaApiKey;
    const apiUrl = environment.daytonaApiUrl;

    if (!apiKey || !apiUrl) {
      throw new Error(
        'DAYTONA_API_KEY and DAYTONA_API_URL must be set to run Daytona provider integration tests',
      );
    }

    app = await createTestModule();

    runtimeProvider = app.get(RuntimeProvider);
    runtimeInstanceDao = app.get(RuntimeInstanceDao);
  }, 60_000);

  afterAll(async () => {
    // Clean up any remaining runtime instances for this test node
    await runtimeProvider.cleanupRuntimesByNodeId(TEST_NODE_ID);
    await app.close();
  }, 120_000);

  it(
    'provide() creates a DB row with Running status',
    { timeout: 300_000 },
    async () => {
      const { runtime, cached } = await runtimeProvider.provide({
        graphId: TEST_GRAPH_ID,
        runtimeNodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.Daytona,
        runtimeStartParams: RUNTIME_START_PARAMS,
      });

      expect(runtime).toBeDefined();
      expect(cached).toBe(false);

      const dbRow = await runtimeInstanceDao.getOne({
        graphId: TEST_GRAPH_ID,
        nodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.Daytona,
      });

      expect(dbRow).not.toBeNull();
      expect(dbRow!.status).toBe(RuntimeInstanceStatus.Running);
      expect(dbRow!.type).toBe(RuntimeType.Daytona);
      expect(dbRow!.containerName).toBeTruthy();

      containerName = dbRow!.containerName;
    },
  );

  it(
    'second provide() returns cached: true',
    { timeout: 60_000 },
    async () => {
      const { cached } = await runtimeProvider.provide({
        graphId: TEST_GRAPH_ID,
        runtimeNodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.Daytona,
        runtimeStartParams: RUNTIME_START_PARAMS,
      });

      expect(cached).toBe(true);
    },
  );

  it(
    'cleanupRuntimesByNodeId removes DB row and deletes Daytona sandbox',
    { timeout: 120_000 },
    async () => {
      const cleanedCount =
        await runtimeProvider.cleanupRuntimesByNodeId(TEST_NODE_ID);
      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      // Verify DB row is gone
      const dbRow = await runtimeInstanceDao.getOne({
        graphId: TEST_GRAPH_ID,
        nodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.Daytona,
      });
      expect(dbRow).toBeNull();

      // Verify the Daytona sandbox is actually deleted
      expect(containerName, 'containerName must be set by the provide() test').toBeTruthy();

      const daytona = new Daytona({
        apiKey: environment.daytonaApiKey || undefined,
        apiUrl: environment.daytonaApiUrl || undefined,
        target: environment.daytonaTarget || undefined,
      });

      let sandboxFound = false;
      try {
        await daytona.findOne({ idOrName: containerName! });
        sandboxFound = true;
      } catch {
        // Expected — 404 means sandbox was deleted
      }
      expect(sandboxFound).toBe(false);
    },
  );

  it(
    'cleanup is idempotent — returns 0 when nothing to clean',
    { timeout: 30_000 },
    async () => {
      const cleanedCount =
        await runtimeProvider.cleanupRuntimesByNodeId(TEST_NODE_ID);
      expect(cleanedCount).toBe(0);
    },
  );
});
