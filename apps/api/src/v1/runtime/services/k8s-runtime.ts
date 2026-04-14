import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';

import { CoreV1Api, Exec, KubeConfig } from '@kubernetes/client-node';
import { InternalException } from '@packages/common';

import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';
import { buildEnvPrefix, shellEscape } from '../runtime.utils';
import { BaseRuntime } from './base-runtime';
import {
  GENIRO_CLAIMED_LABEL,
  GENIRO_GRAPH_LABEL,
  GENIRO_NODE_LABEL,
  GENIRO_RUNTIME_LABEL,
  GENIRO_THREAD_LABEL,
  GENIRO_WARMPOOL_LABEL,
  K8sRuntimeConfig,
  K8sRuntimeLogger,
  K8sWarmPoolClaimant,
} from './k8s-runtime.types';
import {
  buildPodName,
  buildPodSpec,
  extractExitCode,
  isNotFound,
} from './k8s-runtime.utils';

/** Maximum bytes kept for stdout/stderr in exec() — 4 MiB, matches DockerRuntime. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Poll interval (ms) when waiting for a pod to become Ready. */
const POD_READY_POLL_INTERVAL_MS = 1_000;

/** No-op logger used when no logger is supplied. */
const noopLogger: K8sRuntimeLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * K8sRuntime manages exactly one Kubernetes Pod lifecycle: start -> exec (N times) -> stop.
 *
 * Unlike DaytonaRuntime there is no per-session shell queue. Every exec() call is a fresh
 * SPDY-multiplexed Exec against the long-lived pod. The sessionId param on RuntimeExecParams
 * is intentionally ignored — the K8s runtime's concurrency model is stateless (handled
 * server-side by the API server).
 */
export class K8sRuntime extends BaseRuntime {
  private readonly config: K8sRuntimeConfig;
  private readonly logger: K8sRuntimeLogger;
  private readonly imageOverride: string | undefined;
  private readonly warmPool: K8sWarmPoolClaimant | null;

  private kubeConfig: KubeConfig | null = null;
  private coreApi: CoreV1Api | null = null;
  private podName: string | null = null;

  constructor(
    config: K8sRuntimeConfig,
    options: {
      image?: string;
      logger?: K8sRuntimeLogger;
      warmPool?: K8sWarmPoolClaimant | null;
    } = {},
  ) {
    super();
    this.config = config;
    this.logger = options.logger ?? noopLogger;
    this.imageOverride = options.image;
    this.warmPool = options.warmPool ?? null;
  }

  // ---------------------------------------------------------------------------
  // Public accessor
  // ---------------------------------------------------------------------------

  public getPodName(): string | null {
    return this.podName;
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Checks whether the configured Kubernetes namespace is reachable.
   * Makes a lightweight listNamespacedPod call (limit=1) to verify credentials
   * and namespace access without creating any resources.
   */
  static async checkHealth(
    config: K8sRuntimeConfig,
  ): Promise<{ healthy: boolean; error?: string }> {
    try {
      const kc = new KubeConfig();
      if (config.inCluster) {
        kc.loadFromCluster();
      } else {
        kc.loadFromDefault();
      }
      const api = kc.makeApiClient(CoreV1Api);
      await api.listNamespacedPod({ namespace: config.namespace, limit: 1 });
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deletes a pod by name from the configured namespace.
   * Mirrors DaytonaRuntime.stopByName — used by RuntimeProvider's cleanup path
   * when no live K8sRuntime instance is cached in memory.
   */
  static async stopByName(
    name: string,
    config: K8sRuntimeConfig,
  ): Promise<void> {
    try {
      const kc = new KubeConfig();
      if (config.inCluster) {
        kc.loadFromCluster();
      } else {
        kc.loadFromDefault();
      }
      const api = kc.makeApiClient(CoreV1Api);
      await api.deleteNamespacedPod({
        name,
        namespace: config.namespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
      });
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: lazy init
  // ---------------------------------------------------------------------------

  private initKubeConfig(): void {
    if (this.kubeConfig !== null) {
      return;
    }
    const kc = new KubeConfig();
    if (this.config.inCluster) {
      kc.loadFromCluster();
    } else {
      kc.loadFromDefault();
    }
    this.kubeConfig = kc;
    this.coreApi = kc.makeApiClient(CoreV1Api);
  }

  // ---------------------------------------------------------------------------
  // Private: pod readiness poll
  // ---------------------------------------------------------------------------

  /**
   * Polls pod status every POD_READY_POLL_INTERVAL_MS until the pod is Running+Ready
   * or the deadline is reached. Returns true when the pod is ready, false on timeout.
   */
  private async waitForPodReady(deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      try {
        const pod = await this.coreApi!.readNamespacedPodStatus({
          name: this.podName!,
          namespace: this.config.namespace,
        });
        const phase = pod.status?.phase;
        const conditions = pod.status?.conditions ?? [];
        const isReady = conditions.some(
          (c) => c.type === 'Ready' && c.status === 'True',
        );
        if (phase === 'Running' && isReady) {
          return true;
        }
        // Surface a clear error for definitive failure phases
        if (phase === 'Failed' || phase === 'Succeeded') {
          return false;
        }
      } catch {
        // Transient API error — keep polling
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POD_READY_POLL_INTERVAL_MS),
      );
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private: pod creation with 409 handling
  // ---------------------------------------------------------------------------

  /**
   * Attempts to create the pod. On 409 Conflict inspects the existing pod's labels:
   * - If labels match our identity (same thread/node/graph) → adopt the existing pod.
   * - Otherwise → delete the conflicting pod and retry creation once.
   */
  private async createPodWithConflictHandling(
    params: RuntimeStartParams,
    labels: Record<string, string>,
  ): Promise<void> {
    const podSpec = buildPodSpec(
      { ...this.config, image: this.imageOverride ?? this.config.image },
      params,
      this.podName!,
      labels,
      params.labels?.['geniro.io/temporary'] === 'true',
    );

    try {
      await this.coreApi!.createNamespacedPod({
        namespace: this.config.namespace,
        body: podSpec,
      });
      return;
    } catch (createError) {
      if (!K8sRuntime.isConflictError(createError)) {
        throw createError;
      }
    }

    // 409 Conflict: inspect the existing pod
    let existingLabels: Record<string, string> = {};
    try {
      const existing = await this.coreApi!.readNamespacedPod({
        name: this.podName!,
        namespace: this.config.namespace,
      });
      existingLabels =
        (existing.metadata?.labels as Record<string, string>) ?? {};
    } catch {
      // If GET fails, fall through to delete+retry
    }

    const labelsMatch =
      existingLabels[GENIRO_THREAD_LABEL] === labels[GENIRO_THREAD_LABEL] &&
      existingLabels[GENIRO_NODE_LABEL] === labels[GENIRO_NODE_LABEL] &&
      existingLabels[GENIRO_GRAPH_LABEL] === labels[GENIRO_GRAPH_LABEL];

    if (labelsMatch) {
      // Adopt the existing pod — it is ours (same identity)
      this.logger.log(`[K8sRuntime] Adopting existing pod "${this.podName}"`, {
        podName: this.podName,
      });
      return;
    }

    // Mismatched labels — delete and retry once
    this.logger.warn(
      `[K8sRuntime] Conflicting pod "${this.podName}" has different labels, deleting and retrying`,
      { podName: this.podName },
    );
    try {
      await this.coreApi!.deleteNamespacedPod({
        name: this.podName!,
        namespace: this.config.namespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
      });
    } catch (delError) {
      if (!isNotFound(delError)) {
        throw delError;
      }
    }

    // Wait briefly for the pod to be gone before retrying
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    await this.coreApi!.createNamespacedPod({
      namespace: this.config.namespace,
      body: podSpec,
    });
  }

  private static isConflictError(error: unknown): boolean {
    if (error !== null && typeof error === 'object') {
      const candidate = error as Record<string, unknown>;
      if (candidate['code'] === 409 || candidate['statusCode'] === 409) {
        return true;
      }
      const response = candidate['response'];
      if (
        response !== null &&
        typeof response === 'object' &&
        (response as Record<string, unknown>)['statusCode'] === 409
      ) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // BaseRuntime implementation: start()
  // ---------------------------------------------------------------------------

  async start(params: RuntimeStartParams): Promise<void> {
    this.initKubeConfig();

    // Try to claim a warm pod first (no-ops when warmPool is null)
    if (this.warmPool && params.labels) {
      const claimed = await this.warmPool
        .claimWarmPod({
          graphId: params.labels['geniro.io/graph-id'] ?? null,
          nodeId: params.labels['geniro.io/node-id'] ?? '',
          threadId: params.labels['geniro.io/thread-id'] ?? '',
        })
        .catch(() => null);

      if (claimed !== null) {
        this.podName = claimed;
        this.logger.log(`[K8sRuntime] Claimed warm pod "${claimed}"`, {
          podName: claimed,
        });

        const deadline = Date.now() + this.config.readyTimeoutMs;
        const ready = await this.waitForPodReady(deadline);
        if (!ready) {
          this.podName = null;
          throw new InternalException('WARM_POD_NOT_READY', {
            podName: claimed,
          });
        }

        this.emit({ type: 'start', data: { params } });
        return;
      }
    }

    const graphId = params.labels?.[GENIRO_GRAPH_LABEL] ?? null;
    const nodeId = params.labels?.[GENIRO_NODE_LABEL] ?? randomUUID();
    const threadId = params.labels?.[GENIRO_THREAD_LABEL] ?? randomUUID();

    this.podName =
      params.containerName ?? buildPodName(graphId, nodeId, threadId);

    const labels: Record<string, string> = {
      [GENIRO_RUNTIME_LABEL]: 'true',
      [GENIRO_WARMPOOL_LABEL]: 'false',
      [GENIRO_CLAIMED_LABEL]: 'false',
      [GENIRO_GRAPH_LABEL]: graphId ?? '',
      [GENIRO_NODE_LABEL]: nodeId,
      [GENIRO_THREAD_LABEL]: threadId,
      ...(params.labels ?? {}),
    };

    try {
      await this.createPodWithConflictHandling(params, labels);

      const deadline = Date.now() + this.config.readyTimeoutMs;
      const ready = await this.waitForPodReady(deadline);

      if (!ready) {
        // Delete pod and surface a descriptive error
        await this.coreApi!.deleteNamespacedPod({
          name: this.podName,
          namespace: this.config.namespace,
          gracePeriodSeconds: 0,
          propagationPolicy: 'Background',
        }).catch(() => undefined);

        const msg =
          `[K8sRuntime] Pod "${this.podName}" did not become Ready within ` +
          `${this.config.readyTimeoutMs} ms`;
        this.podName = null;
        throw new InternalException('POD_READY_TIMEOUT', msg);
      }

      if (params.initScript) {
        await this.runInitScript(
          params.initScript,
          params.env,
          params.initScriptTimeoutMs,
        );
      }

      this.emit({ type: 'start', data: { params } });
    } catch (error) {
      this.emit({ type: 'start', data: { params, error } });
      throw error;
    }
  }

  private async runInitScript(
    script: string | string[],
    env?: Record<string, string>,
    timeoutMs?: number,
  ): Promise<void> {
    const cmds = Array.isArray(script) ? script : [script];
    for (const cmd of cmds) {
      const res = await this.exec({
        cmd,
        env,
        timeoutMs: timeoutMs ?? 10 * 60_000,
      });
      if (res.fail) {
        throw new InternalException('INIT_SCRIPT_FAILED', {
          stderr: res.stderr,
          stdout: res.stdout,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // BaseRuntime implementation: stop()
  // ---------------------------------------------------------------------------

  async stop(): Promise<void> {
    const name = this.podName;
    try {
      if (!name) {
        return;
      }

      await this.coreApi!.deleteNamespacedPod({
        name,
        namespace: this.config.namespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
      });

      this.podName = null;
      this.emit({ type: 'stop', data: {} });
    } catch (error) {
      if (isNotFound(error)) {
        this.podName = null;
        this.emit({ type: 'stop', data: {} });
        return;
      }
      this.emit({ type: 'stop', data: { error } });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // BaseRuntime implementation: exec()
  // ---------------------------------------------------------------------------

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    if (!this.podName || !this.kubeConfig) {
      throw new InternalException('RUNTIME_NOT_STARTED');
    }

    // sessionId is a no-op for K8s — each call is a fresh Exec (stateless model)
    const execId = randomUUID();
    const fullWorkdir = this.getWorkdir(params.cwd);

    // Build the shell script: env exports + optional cd + user command.
    // String form: caller is responsible for safe content.
    // Array form: each element is treated as a shell token and escaped to prevent injection.
    const envPrefix = buildEnvPrefix(params.env);
    let cmdString: string;
    if (Array.isArray(params.cmd)) {
      cmdString = params.cmd.map(shellEscape).join(' && ');
    } else {
      cmdString = params.cmd;
    }

    if (params.cwd) {
      cmdString = `cd ${shellEscape(params.cwd)} && ${cmdString}`;
    }

    const script = `${envPrefix}${cmdString}`;
    const command = ['/bin/sh', '-c', script];

    this.emit({ type: 'execStart', data: { execId, params } });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    let stdoutBuf = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
    let stderrBuf = Buffer.alloc(0) as Buffer<ArrayBufferLike>;

    stdoutStream.on('data', (chunk: Buffer) => {
      stdoutBuf = this.appendTail(
        stdoutBuf,
        chunk as Buffer<ArrayBufferLike>,
        MAX_OUTPUT_BYTES,
      );
    });
    stderrStream.on('data', (chunk: Buffer) => {
      stderrBuf = this.appendTail(
        stderrBuf,
        chunk as Buffer<ArrayBufferLike>,
        MAX_OUTPUT_BYTES,
      );
    });

    try {
      const exitCode = await this.runExec(
        command,
        stdoutStream,
        stderrStream,
        params,
      );

      const stdout = stdoutBuf.toString('utf8');
      const stderr = stderrBuf.toString('utf8');

      const result: RuntimeExecResult = {
        exitCode,
        stdout,
        stderr,
        fail: exitCode !== 0,
        execPath: fullWorkdir,
      };

      this.emit({ type: 'execEnd', data: { execId, params, result } });
      return result;
    } catch (error) {
      this.emit({ type: 'execEnd', data: { execId, params, error } });
      throw error;
    } finally {
      // Always destroy PassThrough streams to prevent listener leaks
      stdoutStream.destroy();
      stderrStream.destroy();
    }
  }

  /**
   * Runs a command via the Kubernetes Exec API and returns the exit code.
   * Respects params.signal and params.timeoutMs.
   */
  private runExec(
    command: string[],
    stdoutStream: PassThrough,
    stderrStream: PassThrough,
    params: RuntimeExecParams,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      let wsHandle: { close(): void } | null = null;
      let timeoutTimer: NodeJS.Timeout | null = null;
      let abortCleanup: (() => void) | null = null;

      const settle = (code: number) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
        }
        if (abortCleanup !== null) {
          abortCleanup();
        }
        resolve(code);
      };

      const fail = (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
        }
        if (abortCleanup !== null) {
          abortCleanup();
        }
        reject(err);
      };

      const forceClose = (code: number) => {
        if (!settled) {
          try {
            wsHandle?.close();
          } catch {
            // ignore
          }
          settle(code);
        }
      };

      // Wire up AbortSignal
      if (params.signal) {
        if (params.signal.aborted) {
          settle(124);
          return;
        }
        const onAbort = () => forceClose(124);
        params.signal.addEventListener('abort', onAbort, { once: true });
        abortCleanup = () => {
          try {
            params.signal!.removeEventListener('abort', onAbort);
          } catch {
            // ignore
          }
        };
      }

      // Wire up timeout
      if (params.timeoutMs && params.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          forceClose(124);
        }, params.timeoutMs).unref();
      }

      const execInstance = new Exec(this.kubeConfig!);
      const statusCallback = (status: unknown) => {
        settle(extractExitCode(status));
      };

      execInstance
        .exec(
          this.config.namespace,
          this.podName!,
          'runtime',
          command,
          stdoutStream,
          stderrStream,
          null,
          false,
          statusCallback,
        )
        .then((ws: { close(): void }) => {
          wsHandle = ws;
          // If already settled (signal/timeout fired before exec resolved) close immediately
          if (settled) {
            try {
              ws.close();
            } catch {
              // ignore
            }
          }
        })
        .catch((err: unknown) => {
          fail(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  // ---------------------------------------------------------------------------
  // BaseRuntime implementation: execStream()
  // ---------------------------------------------------------------------------

  /**
   * Opens a persistent SPDY Exec connection against the pod.
   * Returns demuxed stdin/stdout/stderr streams — no echo filter needed
   * because SPDY cleanly separates channels.
   */
  public override async execStream(
    command: string[],
    options?: {
      workdir?: string;
      env?: Record<string, string>;
    },
  ): Promise<{
    stdin: Duplex;
    stdout: PassThrough;
    stderr: PassThrough;
    close: () => void;
  }> {
    if (!this.podName || !this.kubeConfig) {
      throw new InternalException('RUNTIME_NOT_STARTED');
    }

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough() as unknown as Duplex;

    // Build final command with optional env prefix.
    // When an env prefix is needed, each command token is shell-escaped before joining
    // to prevent injection through caller-controlled command parts.
    const envPrefix = buildEnvPrefix(options?.env);
    const finalCommand =
      envPrefix && command.length > 0
        ? ['/bin/sh', '-c', `${envPrefix}${command.map(shellEscape).join(' ')}`]
        : command;

    const execInstance = new Exec(this.kubeConfig);
    // Exec.exec() returns Promise<WebSocket.WebSocket>; we only need .close() here.
    const ws = (await execInstance.exec(
      this.config.namespace,
      this.podName,
      'runtime',
      finalCommand,
      stdout,
      stderr,
      stdin,
      false,
      (_status: unknown) => {
        // Stream ended — close passthrough streams
        if (!stdout.destroyed) {
          stdout.end();
        }
        if (!stderr.destroyed) {
          stderr.end();
        }
      },
    )) as { close(): void };

    return {
      stdin,
      stdout,
      stderr,
      close: () => {
        try {
          ws.close();
          stdin.destroy();
          stdout.destroy();
          stderr.destroy();
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  }
}
