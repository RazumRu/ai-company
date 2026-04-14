/** Configuration required to connect to and operate within a Kubernetes cluster. */
export interface K8sRuntimeConfig {
  namespace: string;
  image: string;
  /** Set to an empty string to omit RuntimeClass from pod specs. */
  runtimeClass: string;
  serviceAccount: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  readyTimeoutMs: number;
  inCluster: boolean;
}

/** Minimal logger interface accepted by K8sRuntime. */
export interface K8sRuntimeLogger {
  log(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(error: Error, message: string, context?: Record<string, unknown>): void;
}

export const GENIRO_RUNTIME_LABEL = 'geniro.io/runtime';
export const GENIRO_WARMPOOL_LABEL = 'geniro.io/warm-pool';
export const GENIRO_CLAIMED_LABEL = 'geniro.io/claimed';
export const GENIRO_THREAD_LABEL = 'geniro.io/thread-id';
export const GENIRO_NODE_LABEL = 'geniro.io/node-id';
export const GENIRO_GRAPH_LABEL = 'geniro.io/graph-id';

/**
 * Label map used in strategic-merge-PATCH bodies where null removes a label.
 * Kubernetes strategic-merge interprets null values as deletions.
 */
export type LabelPatch = Record<string, string | null>;

/**
 * Forward-declaration interface matching the shape of K8sWarmPoolService.claimWarmPod
 * (Step 8). K8sRuntime depends on this interface rather than the concrete class so
 * the two steps can be compiled independently.
 */
export interface K8sWarmPoolClaimant {
  claimWarmPod(params: {
    graphId: string | null;
    nodeId: string;
    threadId: string;
  }): Promise<string | null>;
}
