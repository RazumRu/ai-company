import { describe, expect, it } from 'vitest';

import { GENIRO_RUNTIME_LABEL, K8sRuntimeConfig } from './k8s-runtime.types';
import {
  buildPodName,
  buildPodSpec,
  extractExitCode,
  isNotFound,
} from './k8s-runtime.utils';

const baseConfig: K8sRuntimeConfig = {
  namespace: 'geniro',
  image: 'ghcr.io/geniro/runtime:latest',
  runtimeClass: 'gvisor',
  serviceAccount: 'geniro-runtime',
  cpuRequest: '100m',
  cpuLimit: '2',
  memoryRequest: '128Mi',
  memoryLimit: '2Gi',
  readyTimeoutMs: 60_000,
  inCluster: true,
};

describe('buildPodName', () => {
  it('is deterministic — same inputs produce the same output', () => {
    const a = buildPodName('graph-1', 'node-1', 'thread-1');
    const b = buildPodName('graph-1', 'node-1', 'thread-1');
    expect(a).toBe(b);
  });

  it('produces different names for different inputs', () => {
    const a = buildPodName('graph-1', 'node-1', 'thread-1');
    const b = buildPodName('graph-1', 'node-1', 'thread-2');
    expect(a).not.toBe(b);
  });

  it('works when graphId is null', () => {
    const name = buildPodName(null, 'node-1', 'thread-1');
    expect(name).toBeTruthy();
    expect(name.startsWith('geniro-sb-')).toBe(true);
  });

  it('is DNS-1123 compliant — only lowercase alphanumeric and hyphens', () => {
    const name = buildPodName('graph-xyz', 'node-abc', 'thread-789');
    expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('is DNS-1123 compliant — length is 63 chars or fewer', () => {
    const name = buildPodName(
      'a'.repeat(100),
      'b'.repeat(100),
      'c'.repeat(100),
    );
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('starts with geniro-sb- prefix', () => {
    const name = buildPodName('g', 'n', 't');
    expect(name).toMatch(/^geniro-sb-[0-9a-f]{12}$/);
  });
});

describe('buildPodSpec', () => {
  it('omits runtimeClassName when runtimeClass is empty string', () => {
    const config: K8sRuntimeConfig = { ...baseConfig, runtimeClass: '' };
    const pod = buildPodSpec(config, {}, 'test-pod', {}, false);
    expect(pod.spec?.runtimeClassName).toBeUndefined();
  });

  it('sets runtimeClassName when runtimeClass is non-empty', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.spec?.runtimeClassName).toBe('gvisor');
  });

  it('sets activeDeadlineSeconds when temporary is true', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, true);
    expect(pod.spec?.activeDeadlineSeconds).toBe(600);
  });

  it('does not set activeDeadlineSeconds when temporary is false', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.spec?.activeDeadlineSeconds).toBeUndefined();
  });

  it('sets GENIRO_RUNTIME_LABEL in pod labels', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.metadata?.labels?.[GENIRO_RUNTIME_LABEL]).toBe('true');
  });

  it('merges caller-supplied labels with the runtime label', () => {
    const extra = { 'geniro.io/thread-id': 'thread-abc' };
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', extra, false);
    expect(pod.metadata?.labels?.[GENIRO_RUNTIME_LABEL]).toBe('true');
    expect(pod.metadata?.labels?.['geniro.io/thread-id']).toBe('thread-abc');
  });

  it('uses params.image over config.image when provided', () => {
    const pod = buildPodSpec(
      baseConfig,
      { image: 'custom:v2' },
      'test-pod',
      {},
      false,
    );
    expect(pod.spec?.containers[0]?.image).toBe('custom:v2');
  });

  it('falls back to config.image when params.image is absent', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.spec?.containers[0]?.image).toBe(baseConfig.image);
  });

  it('maps params.env entries to container env vars', () => {
    const pod = buildPodSpec(
      baseConfig,
      { env: { FOO: 'bar', BAZ: 'qux' } },
      'test-pod',
      {},
      false,
    );
    const env = pod.spec?.containers[0]?.env ?? [];
    expect(env).toContainEqual({ name: 'FOO', value: 'bar' });
    expect(env).toContainEqual({ name: 'BAZ', value: 'qux' });
  });

  it('sets pod name and namespace from arguments and config', () => {
    const pod = buildPodSpec(baseConfig, {}, 'my-pod-name', {}, false);
    expect(pod.metadata?.name).toBe('my-pod-name');
    expect(pod.metadata?.namespace).toBe(baseConfig.namespace);
  });

  it('sets restartPolicy to Never', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.spec?.restartPolicy).toBe('Never');
  });

  it('sets securityContext with runAsNonRoot and runAsUser 1000', () => {
    const pod = buildPodSpec(baseConfig, {}, 'test-pod', {}, false);
    expect(pod.spec?.securityContext?.runAsNonRoot).toBe(true);
    expect(pod.spec?.securityContext?.runAsUser).toBe(1000);
  });
});

describe('isNotFound', () => {
  it('returns true for ApiException with code 404', async () => {
    const { ApiException } = await import('@kubernetes/client-node');
    const err = new ApiException(404, 'Not Found', undefined, {});
    expect(isNotFound(err)).toBe(true);
  });

  it('returns false for ApiException with code 500', async () => {
    const { ApiException } = await import('@kubernetes/client-node');
    const err = new ApiException(500, 'Internal Server Error', undefined, {});
    expect(isNotFound(err)).toBe(false);
  });

  it('returns true for duck-typed error with code 404', () => {
    expect(isNotFound({ code: 404 })).toBe(true);
  });

  it('returns true for duck-typed error with statusCode 404', () => {
    expect(isNotFound({ statusCode: 404 })).toBe(true);
  });

  it('returns true for duck-typed error with nested response.statusCode 404', () => {
    expect(isNotFound({ response: { statusCode: 404 } })).toBe(true);
  });

  it('returns false for a non-404 duck-typed error', () => {
    expect(isNotFound({ code: 403 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNotFound(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isNotFound('not found')).toBe(false);
  });
});

describe('extractExitCode', () => {
  it('returns the ExitCode cause message as an integer', () => {
    const status = {
      status: 'Failure',
      details: {
        causes: [{ reason: 'ExitCode', message: '2' }],
      },
    };
    expect(extractExitCode(status)).toBe(2);
  });

  it('returns 0 when status is Success without an explicit ExitCode cause', () => {
    const status = { status: 'Success' };
    expect(extractExitCode(status)).toBe(0);
  });

  it('returns 0 when status is Success with causes but no ExitCode cause', () => {
    const status = {
      status: 'Success',
      details: { causes: [{ reason: 'SomeOtherReason', message: '5' }] },
    };
    expect(extractExitCode(status)).toBe(0);
  });

  it('returns 1 when status is Failure without an explicit ExitCode cause', () => {
    const status = { status: 'Failure' };
    expect(extractExitCode(status)).toBe(1);
  });

  it('returns 1 when status is Failure with empty causes array', () => {
    const status = { status: 'Failure', details: { causes: [] } };
    expect(extractExitCode(status)).toBe(1);
  });

  it('returns 1 as fallback for an unknown status string', () => {
    const status = { status: 'Unknown' };
    expect(extractExitCode(status)).toBe(1);
  });

  it('returns 1 for null input (abnormal WebSocket close masks as failure)', () => {
    expect(extractExitCode(null)).toBe(1);
  });

  it('returns 1 for non-object input', () => {
    expect(extractExitCode('unexpected')).toBe(1);
  });
});
