import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RuntimeInstanceDao } from '../../../v1/runtime/dao/runtime-instance.dao';
import {
  RuntimeInstanceStatus,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { createTestModule } from '../setup';

/**
 * Integration tests for RuntimeProvider with K8s backend.
 *
 * These tests exercise the full provide() -> DB row -> cleanup flow through
 * the NestJS DI container with a real database and a real Kubernetes cluster.
 *
 * Prerequisites:
 *  - A reachable Kubernetes cluster configured via KUBECONFIG (e.g. Docker Desktop K8s, kind, k3d)
 *    OR in-cluster auth when running inside a pod (K8S_IN_CLUSTER=true).
 *  - A running PostgreSQL database (standard integration test requirement).
 *  - The K8s runtime namespace must exist with RBAC permissions to create/exec/delete Pods.
 *    The namespace is determined by the K8S_RUNTIME_NAMESPACE env var used by the app's
 *    environment config (defaults to whatever the running config specifies).
 *
 * If neither KUBECONFIG nor K8S_IN_CLUSTER=true is set, the tests will fail with
 * a clear error message (no silent skipping per project policy).
 *
 * Override test-specific image via:
 *  - K8S_INT_TEST_IMAGE — container image for the test pod (default: busybox:1.36)
 */

const TEST_IMAGE = process.env.K8S_INT_TEST_IMAGE ?? 'busybox:1.36';
const TEST_NODE_ID = `k8s-runtime-node-${Date.now()}`;
const TEST_GRAPH_ID = '00000000-0000-0000-0000-000000000099';
const TEST_THREAD_ID = `k8s-provider-thread-${Date.now()}`;
const RUNTIME_START_PARAMS = { image: TEST_IMAGE };

const IN_CLUSTER = process.env.K8S_IN_CLUSTER === 'true';
const KUBECONFIG_PATH = process.env.KUBECONFIG;

describe('RuntimeProvider K8s Integration', () => {
  let app: INestApplication;
  let runtimeProvider: RuntimeProvider;
  let runtimeInstanceDao: RuntimeInstanceDao;

  beforeAll(async () => {
    if (!IN_CLUSTER && !KUBECONFIG_PATH) {
      throw new Error(
        'K8s provider integration tests require either K8S_IN_CLUSTER=true or the KUBECONFIG ' +
          'environment variable pointing at a reachable cluster (e.g. Docker Desktop K8s, kind, k3d). ' +
          'Also ensure a running PostgreSQL database is available.',
      );
    }

    app = await createTestModule();

    runtimeProvider = app.get(RuntimeProvider);
    runtimeInstanceDao = app.get(RuntimeInstanceDao);
  }, 60_000);

  afterAll(async () => {
    // Clean up any remaining runtime instances created by this test run
    await runtimeProvider
      .cleanupRuntimesByNodeId(TEST_NODE_ID)
      .catch(() => undefined);
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
        type: RuntimeType.K8s,
        runtimeStartParams: RUNTIME_START_PARAMS,
      });

      expect(runtime).toBeDefined();
      expect(cached).toBe(false);

      const dbRow = await runtimeInstanceDao.getOne({
        graphId: TEST_GRAPH_ID,
        nodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.K8s,
      });

      expect(dbRow).not.toBeNull();
      expect(dbRow!.status).toBe(RuntimeInstanceStatus.Running);
      expect(dbRow!.type).toBe(RuntimeType.K8s);
      expect(dbRow!.containerName).toBeTruthy();
    },
  );

  it('second provide() returns cached: true', { timeout: 60_000 }, async () => {
    const { cached } = await runtimeProvider.provide({
      graphId: TEST_GRAPH_ID,
      runtimeNodeId: TEST_NODE_ID,
      threadId: TEST_THREAD_ID,
      type: RuntimeType.K8s,
      runtimeStartParams: RUNTIME_START_PARAMS,
    });

    expect(cached).toBe(true);
  });

  it(
    'cleanupRuntimesByNodeId removes DB row and deletes K8s pod',
    { timeout: 120_000 },
    async () => {
      const cleanedCount =
        await runtimeProvider.cleanupRuntimesByNodeId(TEST_NODE_ID);
      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      // Verify the DB row is gone
      const dbRow = await runtimeInstanceDao.getOne({
        graphId: TEST_GRAPH_ID,
        nodeId: TEST_NODE_ID,
        threadId: TEST_THREAD_ID,
        type: RuntimeType.K8s,
      });
      expect(dbRow).toBeNull();
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
