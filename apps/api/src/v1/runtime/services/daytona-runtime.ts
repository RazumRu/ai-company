import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';

import type { DaytonaConfig } from '@daytonaio/sdk';
import { Daytona, Sandbox } from '@daytonaio/sdk';

import { environment } from '../../../environments';
import {
  RuntimeExecParams,
  RuntimeExecResult,
  RuntimeStartParams,
} from '../runtime.types';
import { buildEnvPrefix } from '../runtime.utils';
import { BaseRuntime } from './base-runtime';

/** Configuration needed to connect to the Daytona API. */
export interface DaytonaRuntimeConfig {
  apiKey: string;
  apiUrl: string;
  target?: string;
}

/** Minimal logger interface accepted by DaytonaRuntime. */
export interface DaytonaRuntimeLogger {
  log(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string | Error, message?: string, ...args: unknown[]): void;
}

const SANDBOX_CREATE_TIMEOUT_SECONDS = 300;

/** No new stdout/stderr output for this duration → command is considered stuck. */
const IDLE_TIMEOUT_MS = 300_000;

/** Absolute wall-clock limit; overridden by params.timeoutMs when provided. */
const HARD_TIMEOUT_MS = 3_600_000;

/** Initial poll interval for adaptive backoff (ms). */
const INITIAL_POLL_MS = 200;

/** Maximum poll interval cap for adaptive backoff (ms). */
const MAX_POLL_MS = 2000;

/** Timeout for snapshot log fetch to prevent hanging Daytona API from blocking the poll loop. */
const SYNC_LOGS_TIMEOUT_MS = 5000;

/**
 * DaytonaRuntime using the @daytonaio/sdk
 *
 * Each instance manages exactly one Daytona sandbox lifecycle: start -> exec (any number) -> stop.
 * Sessions are created lazily via the Daytona process session API.
 */
export class DaytonaRuntime extends BaseRuntime {
  private daytona: Daytona | null = null;
  private sandbox: Sandbox | null = null;
  private readonly config: DaytonaRuntimeConfig;
  private readonly snapshot: string;
  private readonly logger?: DaytonaRuntimeLogger;
  private readonly activeSessions = new Set<string>();

  constructor(
    config?: DaytonaRuntimeConfig,
    params?: { snapshot?: string; logger?: DaytonaRuntimeLogger },
  ) {
    super();
    this.config = config ?? {
      apiKey: '',
      apiUrl: '',
    };
    this.snapshot = params?.snapshot || environment.dockerRuntimeImage || '';
    this.logger = params?.logger;
  }

  private buildDaytonaConfig(): DaytonaConfig {
    return {
      apiKey: this.config.apiKey || undefined,
      apiUrl: this.config.apiUrl || undefined,
      target: this.config.target || undefined,
    };
  }

  static async stopByName(
    name: string,
    config?: DaytonaRuntimeConfig,
  ): Promise<void> {
    const daytona = new Daytona({
      apiKey: config?.apiKey || undefined,
      apiUrl: config?.apiUrl || undefined,
      target: config?.target || undefined,
    });

    try {
      const sandbox = await daytona.findOne({ idOrName: name });
      await daytona.delete(sandbox).catch(() => undefined);
    } catch {
      // Sandbox not found or already deleted — nothing to do
    }
  }

  /**
   * Returns the underlying Daytona Sandbox instance, if started.
   * Used by DaytonaExecTransport for MCP session-based communication.
   */
  public getSandbox(): Sandbox | null {
    return this.sandbox;
  }

  async start(params?: RuntimeStartParams): Promise<void> {
    if (this.sandbox) {
      return;
    }

    this.daytona = new Daytona(this.buildDaytonaConfig());

    const sandboxName = params?.containerName || `rt-${randomUUID()}`;
    const snapshotOrImage = params?.image || this.snapshot;

    // Check if an existing sandbox can be reused
    if (!params?.recreate) {
      try {
        const existing = await this.daytona.findOne({ idOrName: sandboxName });
        if (existing) {
          if (existing.state !== 'started') {
            await this.daytona.start(existing, SANDBOX_CREATE_TIMEOUT_SECONDS);
          }
          this.sandbox = existing;
          this.emit({ type: 'start', data: { params: params || {} } });
          return;
        }
      } catch {
        // Not found — will create
      }
    }

    if (params?.recreate) {
      try {
        const existing = await this.daytona.findOne({ idOrName: sandboxName });
        if (existing) {
          await this.daytona.delete(existing).catch(() => undefined);
        }
      } catch {
        // Not found — nothing to clean up
      }
    }

    const commonParams = {
      name: sandboxName,
      envVars: params?.env,
      labels: params?.labels,
      // Disable auto-stop so long-running sandbox stays alive
      autoStopInterval: 0,
    };

    try {
      this.sandbox = await this.createSandbox(commonParams, snapshotOrImage);
    } catch (error) {
      // If the cached snapshot image was lost (e.g. runner DinD wiped after
      // recreate), Daytona returns "pull access denied" because the built
      // snapshot no longer exists in the runner's local registry.
      // Invalidate the stale snapshot and retry once so it rebuilds fresh.
      if (snapshotOrImage && this.isStaleSnapshotError(error)) {
        this.logger?.warn(
          `[DaytonaRuntime] Sandbox creation failed with stale snapshot error. ` +
            `Invalidating cached snapshot for "${snapshotOrImage}" and retrying…`,
        );

        await this.invalidateStaleSnapshot(snapshotOrImage);

        // Clean up the failed sandbox so the retry can reuse the same name
        try {
          const failed = await this.daytona!.findOne({
            idOrName: sandboxName,
          });
          if (failed) {
            await this.daytona!.delete(failed).catch((e) => {
              this.logger?.warn(
                `[DaytonaRuntime] Failed to delete failed sandbox "${sandboxName}": ${
                  e instanceof Error ? e.message : String(e)
                }`,
              );
            });
          }
        } catch {
          // Not found — already cleaned up
        }

        try {
          this.sandbox = await this.createSandbox(
            commonParams,
            snapshotOrImage,
          );
        } catch (retryError) {
          this.emit({
            type: 'start',
            data: { params: params || {}, error: retryError },
          });
          throw retryError;
        }
      } else {
        this.emit({ type: 'start', data: { params: params || {}, error } });
        throw error;
      }
    }

    try {
      if (params?.initScript) {
        await this.runInitScript(
          params.initScript,
          params.env,
          params.initScriptTimeoutMs,
        );
      }

      this.emit({ type: 'start', data: { params: params || {} } });
    } catch (error) {
      this.emit({ type: 'start', data: { params: params || {}, error } });
      throw error;
    }
  }

  private async runInitScript(
    script?: string | string[],
    env?: Record<string, string>,
    timeoutMs?: number,
  ) {
    if (!script) {
      return;
    }

    const cmds = Array.isArray(script) ? script : [script];
    const timeoutSeconds = Math.ceil((timeoutMs ?? 10 * 60_000) / 1000);

    for (const cmd of cmds) {
      const res = await this.exec({
        cmd,
        env,
        timeoutMs: timeoutSeconds * 1000,
      });
      if (res.fail) {
        throw new Error(`Init failed: ${res.stderr || res.stdout}`);
      }
    }
  }

  async stop(): Promise<void> {
    try {
      if (!this.sandbox || !this.daytona) {
        return;
      }

      // Clean up sessions
      for (const sessionId of this.activeSessions) {
        try {
          await this.sandbox.process.deleteSession(sessionId);
        } catch {
          // Session may already be gone
        }
      }
      this.activeSessions.clear();

      await this.daytona.delete(this.sandbox).catch(() => undefined);
      this.sandbox = null;
      this.daytona = null;

      this.emit({ type: 'stop', data: {} });
    } catch (error) {
      this.emit({ type: 'stop', data: { error } });
      throw error;
    }
  }

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    if (!this.sandbox) {
      throw new Error('Runtime not started');
    }

    const fullWorkdir = this.getWorkdir(params.cwd) || this.workdir;
    const execId = randomUUID();

    let cmdString: string;
    if (Array.isArray(params.cmd)) {
      cmdString = params.cmd.join(' && ');
    } else {
      cmdString = params.cmd;
    }

    // Prepend cd when cwd is specified
    if (params.cwd) {
      cmdString = `cd ${JSON.stringify(params.cwd)} && ${cmdString}`;
    }

    this.emit({
      type: 'execStart',
      data: { execId, params },
    });

    if (params.sessionId) {
      try {
        const result = await this.execInSession(params, cmdString);
        this.emit({
          type: 'execEnd',
          data: { execId, params, result },
        });
        return result;
      } catch (error) {
        // Session may be stuck after a timeout or network error.
        // Recreate it so subsequent commands on this session don't hang.
        // Store the promise so concurrent callers (execInSession) can await it.
        this.sessionRecreatePromise = this.recreateSession(params.sessionId);
        await this.sessionRecreatePromise;

        const err = error instanceof Error ? error.message : String(error);
        const result: RuntimeExecResult = {
          exitCode: 124,
          stdout: '',
          stderr: err,
          fail: true,
          execPath: fullWorkdir,
        };
        this.emit({
          type: 'execEnd',
          data: { execId, params, error },
        });
        return result;
      }
    }

    // One-shot execution via a temporary session.
    // Using executeSessionCommand instead of executeCommand gives proper
    // stdout/stderr separation (executeCommand interleaves them into a
    // single `result` string).
    try {
      const result = await this.execOneShot(params, cmdString, fullWorkdir);
      this.emit({
        type: 'execEnd',
        data: { execId, params, result },
      });
      return result;
    } catch (error) {
      this.emit({
        type: 'execEnd',
        data: { execId, params, error },
      });

      throw error;
    }
  }

  /**
   * Pending session recreation promise. Callers must await this before using
   * the session to avoid racing against a background delete+create.
   */
  private sessionRecreatePromise: Promise<void> | null = null;

  private async execInSession(
    params: RuntimeExecParams,
    cmdString: string,
  ): Promise<RuntimeExecResult> {
    const sessionId = params.sessionId as string;
    const fullWorkdir = this.getWorkdir(params.cwd) || this.workdir;

    // Wait for any pending session recreation to finish before proceeding
    if (this.sessionRecreatePromise) {
      await this.sessionRecreatePromise;
      this.sessionRecreatePromise = null;
    }

    // Ensure session exists
    if (!this.activeSessions.has(sessionId)) {
      await this.sandbox!.process.createSession(sessionId);
      this.activeSessions.add(sessionId);
      // Initialize session CWD to this.workdir, mirroring Docker's WorkingDir behaviour.
      // Daytona sessions start in the sandbox default (e.g. /home/daytona) which does not
      // match this.workdir (/runtime-workspace).  Without this, cloned repos land in the
      // wrong directory while execPath still reports /runtime-workspace, causing tools
      // (explorer, shell) to look for files that don't exist at the reported path.
      try {
        await this.sandbox!.process.executeSessionCommand(sessionId, {
          command: `mkdir -p ${this.workdir} && cd ${this.workdir}`,
          runAsync: false,
        });
      } catch {
        this.logger?.warn(
          `[DaytonaRuntime] Failed to initialise session "${sessionId}" workdir "${this.workdir}" — commands may run from the sandbox default directory`,
        );
      }
    }

    // Build env prefix same as Docker runtime
    const envPrefix = buildEnvPrefix(params.env);
    const script = `${envPrefix}${cmdString || ':'}`;

    // Launch command asynchronously so we can detect hangs
    const { cmdId } = await this.sandbox!.process.executeSessionCommand(
      sessionId,
      { command: script, runAsync: true },
    );

    // tailTimeoutMs is intentionally not used here. Daytona manages its own
    // streaming lifecycle via getSessionCommandLogs callbacks, so tail timeouts
    // (which apply to Docker stream inactivity) don't map onto this model.
    return this.awaitCommand({
      sessionId,
      cmdId,
      params,
      fullWorkdir,
      onSessionStuck: (result) => {
        // Start session recreation and store the promise so the next
        // execInSession call can await it before using the session.
        this.sessionRecreatePromise = this.recreateSession(sessionId);
        return result;
      },
    });
  }

  /**
   * Execute a command in a temporary Daytona session (one-shot).
   * Creates an ephemeral session, runs the command asynchronously
   * (`runAsync: true`), polls for completion, and deletes the session afterwards.
   *
   * Using `runAsync: true` is required for long-running commands (e.g. git clone):
   * `runAsync: false` blocks the HTTP connection for the entire command duration,
   * which causes a timeout on Daytona's toolbox HTTP server before the command finishes.
   */
  private async execOneShot(
    params: RuntimeExecParams,
    cmdString: string,
    fullWorkdir: string,
  ): Promise<RuntimeExecResult> {
    const tempSessionId = `oneshot-${randomUUID()}`;
    const timeoutSeconds = params.timeoutMs
      ? Math.ceil(params.timeoutMs / 1000)
      : 0;

    try {
      await this.sandbox!.process.createSession(tempSessionId);

      const envPrefix = buildEnvPrefix(params.env);
      const script = `${envPrefix}${cmdString || ':'}`;

      // Use runAsync: true — runAsync: false blocks the HTTP connection for the
      // entire command duration, causing timeouts on long-running commands (e.g. git clone).
      const { cmdId } = await this.sandbox!.process.executeSessionCommand(
        tempSessionId,
        { command: script, runAsync: true },
        timeoutSeconds || undefined,
      );

      // IMPORTANT: must use `await` here, NOT `return this.awaitCommand(...)`.
      // If we `return` the Promise from inside a try/finally, the `finally`
      // block fires as soon as the Promise object is constructed — before it
      // resolves. That deletes the session while the command is still running,
      // causing the polling loop to get 404s and infer exitCode=0 (false success).
      // Using `await` ensures the `finally` block only runs after the Promise resolves.
      const result = await this.awaitCommand({
        sessionId: tempSessionId,
        cmdId,
        params,
        fullWorkdir,
      });

      return result;
    } finally {
      try {
        await this.sandbox!.process.deleteSession(tempSessionId);
      } catch {
        // Session may already be gone
      }
    }
  }

  /**
   * Shared polling/streaming logic for awaiting a command that has already been
   * submitted via `executeSessionCommand` with `runAsync: true`.
   *
   * Uses two completion signals racing against each other:
   * 1. **Stream** (`getSessionCommandLogs` WebSocket) — primary signal. When it
   *    resolves, fetch exit code via `getSessionCommand`.
   * 2. **Adaptive polling** — safety net. Starts at 200ms, exponential backoff
   *    to 2s cap. Catches fast-exiting commands when the stream hangs.
   *
   * The command itself is NEVER retried. Only `getSessionCommand` (read-only
   * status check) is polled.
   */
  private awaitCommand(opts: {
    sessionId: string;
    cmdId: string;
    params: RuntimeExecParams;
    fullWorkdir: string;
    onSessionStuck?: (result: RuntimeExecResult) => RuntimeExecResult;
  }): Promise<RuntimeExecResult> {
    const { sessionId, cmdId, params, fullWorkdir, onSessionStuck } = opts;

    const hardMs = Math.min(
      params.timeoutMs ?? HARD_TIMEOUT_MS,
      HARD_TIMEOUT_MS,
    );
    const startAt = Date.now();
    let lastOutputAt = Date.now();
    let stdout = '';
    let stderr = '';
    let observedStdoutLength = 0;
    let observedStderrLength = 0;
    let streamActive = true;
    let pollInFlight = false;
    let currentPollMs = INITIAL_POLL_MS;

    return new Promise<RuntimeExecResult>((resolve) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;

      /** Fetch a snapshot of stdout/stderr from the REST API, with a timeout
       *  to prevent a hanging Daytona API from blocking the poll loop. */
      const syncLogsWithTimeout = async () => {
        try {
          const logsPromise = this.sandbox!.process.getSessionCommandLogs(
            sessionId,
            cmdId,
          ) as Promise<{ stdout?: string; stderr?: string }>;

          const logs = await Promise.race([
            logsPromise,
            new Promise<null>((r) => setTimeout(r, SYNC_LOGS_TIMEOUT_MS, null)),
          ]);

          if (!logs) return;

          const nextStdout = logs.stdout ?? '';
          const nextStderr = logs.stderr ?? '';
          const stdoutGrew = nextStdout.length > observedStdoutLength;
          const stderrGrew = nextStderr.length > observedStderrLength;

          if (stdoutGrew) {
            stdout = nextStdout;
            observedStdoutLength = nextStdout.length;
          }
          if (stderrGrew) {
            stderr = nextStderr;
            observedStderrLength = nextStderr.length;
          }
          if (stdoutGrew || stderrGrew) {
            lastOutputAt = Date.now();
          }
        } catch {
          // Snapshot fetch is best-effort; streaming callbacks or later polls may still succeed.
        }
      };

      /** Fetch exit code after stream resolves. If getSessionCommand throws
       *  (404 = cmdId cleaned up), infer from collected output: non-empty
       *  stderr implies failure (exit 1), otherwise assume success (exit 0). */
      const fetchExitCode = async (): Promise<number> => {
        try {
          const cmd = await this.sandbox!.process.getSessionCommand(
            sessionId,
            cmdId,
          );
          if (typeof cmd.exitCode === 'number') {
            return cmd.exitCode;
          }
        } catch {
          // cmdId not found — command completed and was already cleaned up by Daytona
        }
        // Exit code not retrievable. Infer: non-empty stderr → failure (exit 1).
        return stderr.length > 0 ? 1 : 0;
      };

      const settle = (result: RuntimeExecResult) => {
        if (settled) return;
        settled = true;
        streamActive = false;
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        resolve(result);
      };

      const settleWithStuckHandler = (result: RuntimeExecResult) => {
        if (settled) return;
        const finalResult = onSessionStuck ? onSessionStuck(result) : result;
        settle(finalResult);
      };

      // Stream logs — callbacks update lastOutputAt and collect output.
      // This provides a fast-path for commands that exit before the first poll:
      // when Daytona cleans up a fast-exiting cmdId, getSessionCommand() throws a 404 that
      // the polling catch block silently swallows, causing the loop to spin until hard timeout.
      // Resolving via stream completion avoids that race condition entirely.
      void this.sandbox!.process.getSessionCommandLogs(
        sessionId,
        cmdId,
        (chunk: string) => {
          if (!streamActive) return;
          stdout += chunk;
          observedStdoutLength = stdout.length;
          lastOutputAt = Date.now();
        },
        (chunk: string) => {
          if (!streamActive) return;
          stderr += chunk;
          observedStderrLength = stderr.length;
          lastOutputAt = Date.now();
        },
      )
        .then(async () => {
          // Stream resolved → command finished. Do one final exit-code fetch.
          if (settled) return;
          const exitCode = await fetchExitCode();
          await syncLogsWithTimeout();
          settle({
            exitCode,
            stdout,
            stderr,
            fail: exitCode !== 0,
            execPath: fullWorkdir,
          });
        })
        .catch(() => {
          // Stream error on early session kill — expected and intentionally silent.
        });

      const schedulePoll = () => {
        pollTimer = setTimeout(() => {
          if (pollInFlight || settled) {
            if (!settled) schedulePoll();
            return;
          }
          pollInFlight = true;

          void (async () => {
            try {
              if (params.signal?.aborted) {
                settleWithStuckHandler({
                  exitCode: 124,
                  stdout,
                  stderr: 'Aborted',
                  fail: true,
                  execPath: fullWorkdir,
                });
                return;
              }

              await syncLogsWithTimeout();

              const now = Date.now();

              // Idle timeout — no output for the configured idle period
              const idleMs = params.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
              if (now - lastOutputAt >= idleMs) {
                settleWithStuckHandler({
                  exitCode: 124,
                  stdout,
                  stderr: `Idle timeout: no output for ${idleMs / 1000}s`,
                  fail: true,
                  execPath: fullWorkdir,
                });
                return;
              }

              // Hard timeout — wall-clock limit exceeded
              if (now - startAt >= hardMs) {
                settleWithStuckHandler({
                  exitCode: 124,
                  stdout,
                  stderr: `Hard timeout: command exceeded ${hardMs / 1000}s`,
                  fail: true,
                  execPath: fullWorkdir,
                });
                return;
              }

              let cmd: { exitCode?: number } | undefined;
              try {
                cmd = await this.sandbox!.process.getSessionCommand(
                  sessionId,
                  cmdId,
                );
              } catch {
                // getSessionCommand failed — the cmdId is no longer retrievable
                // (e.g. Daytona cleaned it up after a fast exit). Treat as
                // completion: collect whatever output we have and settle.
                await syncLogsWithTimeout();
                const exitCode = stderr.length > 0 ? 1 : 0;
                settle({
                  exitCode,
                  stdout,
                  stderr,
                  fail: exitCode !== 0,
                  execPath: fullWorkdir,
                });
                return;
              }

              if (cmd && typeof cmd.exitCode === 'number') {
                const finalExitCode = cmd.exitCode;
                streamActive = false;
                await syncLogsWithTimeout();

                settle({
                  exitCode: finalExitCode,
                  stdout,
                  stderr,
                  fail: finalExitCode !== 0,
                  execPath: fullWorkdir,
                });
                return;
              }

              // Exponential backoff: double the interval up to MAX_POLL_MS
              currentPollMs = Math.min(currentPollMs * 2, MAX_POLL_MS);
            } finally {
              pollInFlight = false;
              if (!settled) schedulePoll();
            }
          })();
        }, currentPollMs);
      };

      schedulePoll();
    });
  }

  private async createSandbox(
    commonParams: {
      name: string;
      envVars?: Record<string, string>;
      labels?: Record<string, string>;
      autoStopInterval: number;
    },
    snapshotOrImage: string,
  ): Promise<Sandbox> {
    if (snapshotOrImage) {
      // Use `image` — Daytona automatically builds a snapshot from the
      // Docker image on first use and caches it in the transient registry.
      // Subsequent sandbox creations reuse the cached snapshot.
      return this.daytona!.create(
        { ...commonParams, image: snapshotOrImage },
        { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
      );
    }
    return this.daytona!.create(commonParams, {
      timeout: SANDBOX_CREATE_TIMEOUT_SECONDS,
    });
  }

  /**
   * Detects "pull access denied" errors that indicate a stale/missing
   * snapshot image in the runner's local Docker registry.
   */
  private isStaleSnapshotError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('pull access denied');
  }

  /**
   * Finds and deletes the cached Daytona snapshot built from the given image
   * so that the next sandbox creation triggers a fresh snapshot build.
   */
  private async invalidateStaleSnapshot(imageName: string): Promise<void> {
    try {
      const { items } = await this.daytona!.snapshot.list(1, 100);
      const stale = items.find((s) => s.imageName === imageName);
      if (stale) {
        this.logger?.log(
          `[DaytonaRuntime] Deleting stale snapshot "${stale.name}" (id=${stale.id})`,
        );
        await this.daytona!.snapshot.delete(stale);
      } else {
        this.logger?.warn(
          `[DaytonaRuntime] No cached snapshot found for image "${imageName}" — ` +
            `retry will attempt to create from image directly`,
        );
      }
    } catch (err) {
      this.logger?.warn(
        `[DaytonaRuntime] Failed to invalidate stale snapshot: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async recreateSession(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);
    try {
      await this.sandbox!.process.deleteSession(sessionId);
    } catch {
      // Session might already be gone
    }
    try {
      await this.sandbox!.process.createSession(sessionId);
      this.activeSessions.add(sessionId);
    } catch (error) {
      this.logger?.warn(
        `[DaytonaRuntime] Failed to recreate session "${sessionId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  public override async execStream(
    _command: string[],
    _options?: {
      workdir?: string;
      env?: Record<string, string>;
    },
  ): Promise<{
    stdin: Duplex;
    stdout: PassThrough;
    stderr: PassThrough;
    close: () => void;
  }> {
    throw new Error(
      'execStream is not supported by DaytonaRuntime. ' +
        'The Daytona SDK does not provide bidirectional persistent streams. ' +
        'MCP nodes requiring execStream must use Docker runtime.',
    );
  }
}
