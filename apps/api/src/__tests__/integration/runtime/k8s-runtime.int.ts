import { afterAll, expect, it } from 'vitest';

import { K8sRuntime } from '../../../v1/runtime/services/k8s-runtime';
import { K8sRuntimeConfig } from '../../../v1/runtime/services/k8s-runtime.types';
import { describeIfRealK8s as describe } from '../helpers/real-runtime-gate';

/**
 * Integration tests for K8sRuntime lifecycle against a real Kubernetes cluster.
 *
 * Skipped by default. Opt in with `RUN_REAL_K8S_TESTS=1` plus either
 * `K8S_IN_CLUSTER=true` (running inside a pod) or `KUBECONFIG` pointing at a
 * reachable cluster (Docker Desktop K8s, kind, k3d). The target namespace
 * (default `geniro-runtimes-test`) must exist with RBAC for create/exec/delete
 * Pods. Override defaults via `K8S_INT_TEST_NAMESPACE` / `K8S_INT_TEST_IMAGE`.
 */

const TEST_NAMESPACE =
  process.env.K8S_INT_TEST_NAMESPACE ?? 'geniro-runtimes-test';
const TEST_IMAGE = process.env.K8S_INT_TEST_IMAGE ?? 'busybox:1.36';
const IN_CLUSTER = process.env.K8S_IN_CLUSTER === 'true';

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
