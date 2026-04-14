import { createHash } from 'node:crypto';

import type { V1Pod } from '@kubernetes/client-node';
import { ApiException } from '@kubernetes/client-node';

import { environment } from '../../../environments';
import type { RuntimeStartParams } from '../runtime.types';
import type { K8sRuntimeConfig } from './k8s-runtime.types';
import { GENIRO_RUNTIME_LABEL } from './k8s-runtime.types';

/**
 * Builds a deterministic, DNS-1123-compliant pod name from the given identifiers.
 *
 * The name is derived from the sha256 of `${graphId ?? ''}:${nodeId}:${threadId}`,
 * taking the first 12 hex characters as a suffix. Same inputs always produce
 * the same output (idempotent scheduling).
 */
export function buildPodName(
  graphId: string | null,
  nodeId: string,
  threadId: string,
): string {
  const input = `${graphId ?? ''}:${nodeId}:${threadId}`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  return `geniro-sb-${hash}`;
}

/**
 * Constructs a V1Pod manifest for a Geniro sandbox container.
 *
 * When `temporary` is true, `activeDeadlineSeconds` is set to 10 minutes so
 * the pod is automatically killed if the API process crashes mid-job.
 */
export function buildPodSpec(
  config: K8sRuntimeConfig,
  params: RuntimeStartParams,
  podName: string,
  labels: Record<string, string>,
  temporary: boolean,
): V1Pod {
  const pod: V1Pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: config.namespace,
      labels: {
        [GENIRO_RUNTIME_LABEL]: 'true',
        ...labels,
      },
    },
    spec: {
      runtimeClassName: config.runtimeClass || undefined,
      serviceAccountName: config.serviceAccount,
      restartPolicy: 'Never',
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 1000,
      },
      containers: [
        {
          name: 'runtime',
          image: params.image ?? config.image,
          command: ['/bin/sh', '-c', 'sleep infinity'],
          resources: {
            requests: {
              cpu: config.cpuRequest,
              memory: config.memoryRequest,
            },
            limits: {
              cpu: config.cpuLimit,
              memory: config.memoryLimit,
            },
          },
          workingDir: params.workdir,
          env: Object.entries(params.env ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        },
      ],
    },
  };

  if (temporary) {
    pod.spec!.activeDeadlineSeconds = 10 * 60;
  }

  return pod;
}

/**
 * Returns true when the error represents an HTTP 404 Not Found response from
 * the Kubernetes API server.
 */
export function isNotFound(err: unknown): boolean {
  if (err instanceof ApiException) {
    return err.code === 404;
  }

  if (err !== null && typeof err === 'object') {
    const candidate = err as Record<string, unknown>;
    if (candidate['code'] === 404 || candidate['statusCode'] === 404) {
      return true;
    }
    const response = candidate['response'];
    if (
      response !== null &&
      typeof response === 'object' &&
      (response as Record<string, unknown>)['statusCode'] === 404
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Builds a K8sRuntimeConfig from the application environment.
 * Centralises the 10-field config assembly so it is not repeated across
 * runtime-provider.ts, runtime.service.ts, and k8s-warm-pool.service.ts.
 */
export function resolveK8sConfigFromEnv(
  env: typeof environment,
): K8sRuntimeConfig {
  return {
    namespace: env.k8sRuntimeNamespace as string,
    image: env.dockerRuntimeImage as string,
    runtimeClass: env.k8sRuntimeClass as string,
    serviceAccount: env.k8sRuntimeServiceAccount as string,
    cpuRequest: env.k8sRuntimeCpuRequest as string,
    cpuLimit: env.k8sRuntimeCpuLimit as string,
    memoryRequest: env.k8sRuntimeMemoryRequest as string,
    memoryLimit: env.k8sRuntimeMemoryLimit as string,
    readyTimeoutMs: env.k8sRuntimeReadyTimeoutMs as number,
    inCluster: env.k8sInCluster as boolean,
  };
}

/**
 * Extracts the numeric exit code from a Kubernetes Exec API status payload.
 *
 * The Exec API resolves cleanly with `status: 'Success'` when the command exits
 * with code 0 (often without emitting an explicit ExitCode cause). For
 * `status: 'Failure'` the cause with `reason === 'ExitCode'` carries the actual
 * exit code as its message string. If no explicit code is present the function
 * falls back to 0 on Success and 1 on Failure. A null or non-object status
 * (abnormal WebSocket close) is treated as failure and returns 1.
 */
export function extractExitCode(status: unknown): number {
  if (status === null || typeof status !== 'object') {
    return 1;
  }

  const s = status as Record<string, unknown>;
  const statusStr = s['status'];

  const details = s['details'];
  if (details !== null && typeof details === 'object') {
    const causes = (details as Record<string, unknown>)['causes'];
    if (Array.isArray(causes)) {
      const exitCause = causes.find(
        (c: unknown) =>
          c !== null &&
          typeof c === 'object' &&
          (c as Record<string, unknown>)['reason'] === 'ExitCode',
      ) as Record<string, unknown> | undefined;

      if (exitCause !== undefined) {
        const parsed = parseInt(String(exitCause['message']), 10);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
    }
  }

  if (statusStr === 'Success') {
    return 0;
  }

  if (statusStr === 'Failure') {
    return 1;
  }

  // Unknown status string — treat as failure
  return 1;
}
