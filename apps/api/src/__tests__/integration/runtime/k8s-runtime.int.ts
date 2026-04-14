import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { K8sRuntime } from '../../../v1/runtime/services/k8s-runtime';
import { K8sRuntimeConfig } from '../../../v1/runtime/services/k8s-runtime.types';

/**
 * Integration tests for K8sRuntime lifecycle against a real Kubernetes cluster.
 *
 * Prerequisites:
 *  - A reachable Kubernetes cluster configured via KUBECONFIG (e.g. Docker Desktop K8s, kind, k3d)
 *    OR in-cluster auth when running inside a pod (K8S_IN_CLUSTER=true).
 *  - A namespace matching K8S_INT_TEST_NAMESPACE (default: geniro-runtimes-test) must exist
 *    with RBAC permissions to create/exec/delete Pods.
 *
 * If neither KUBECONFIG nor K8S_IN_CLUSTER=true is set, the tests will fail with
 * a clear error message (no silent skipping per project policy).
 *
 * Override defaults via environment variables:
 *  - K8S_INT_TEST_NAMESPACE  — target namespace (default: geniro-runtimes-test)
 *  - K8S_INT_TEST_IMAGE      — container image (default: busybox:1.36)
 *  - K8S_IN_CLUSTER          — set to "true" when running inside a pod
 *  - KUBECONFIG              — path to kubeconfig file (standard K8s env var)
 */

const TEST_NAMESPACE =
  process.env.K8S_INT_TEST_NAMESPACE ?? 'geniro-runtimes-test';
const TEST_IMAGE = process.env.K8S_INT_TEST_IMAGE ?? 'busybox:1.36';
const IN_CLUSTER = process.env.K8S_IN_CLUSTER === 'true';
const KUBECONFIG_PATH = process.env.KUBECONFIG;

describe('K8sRuntime (integration)', () => {
  let runtime: K8sRuntime;

  const config: K8sRuntimeConfig = {
    namespace: TEST_NAMESPACE,
    image: TEST_IMAGE,
    runtimeClass: '', // omit gVisor for local cluster compatibility
    serviceAccount: 'default',
    cpuRequest: '50m',
    cpuLimit: '500m',
    memoryRequest: '64Mi',
    memoryLimit: '256Mi',
    readyTimeoutMs: 60_000,
    inCluster: IN_CLUSTER,
  };

  beforeAll(() => {
    if (!IN_CLUSTER && !KUBECONFIG_PATH) {
      throw new Error(
        'K8sRuntime integration tests require either K8S_IN_CLUSTER=true or the KUBECONFIG ' +
          'environment variable pointing at a reachable cluster (e.g. Docker Desktop K8s, kind, k3d). ' +
          `Also ensure the namespace '${TEST_NAMESPACE}' exists with appropriate RBAC ` +
          '(create/exec/delete Pods).',
      );
    }
  });

  afterAll(async () => {
    await runtime?.stop().catch(() => undefined);
  }, 60_000);

  it('starts a pod and reaches Ready', { timeout: 300_000 }, async () => {
    runtime = new K8sRuntime(config);
    await runtime.start({
      image: TEST_IMAGE,
      containerName: `geniro-sb-it-${Date.now()}`,
    });
    // Pod is Running & Ready if start() resolves without throwing
  });

  it('exec echo hello returns exit 0', { timeout: 60_000 }, async () => {
    const result = await runtime.exec({ cmd: 'echo hello' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.fail).toBe(false);
  });

  it('exec exit 7 returns exit 7', { timeout: 60_000 }, async () => {
    const result = await runtime.exec({ cmd: 'exit 7' });
    expect(result.exitCode).toBe(7);
    expect(result.fail).toBe(true);
  });

  it('execStream emits stdout lines', { timeout: 60_000 }, async () => {
    const { stdout, close } = await runtime.execStream([
      '/bin/sh',
      '-c',
      'echo streamed',
    ]);

    let output = '';
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      stdout.once('end', () => resolve());
      setTimeout(() => reject(new Error('execStream timeout')), 30_000);
    });
    expect(output).toContain('streamed');
    close();
  });

  it('stop removes the pod', { timeout: 60_000 }, async () => {
    await runtime.stop();
    // A second stop() must be idempotent (pod already gone)
    await runtime.stop();
  });
});
