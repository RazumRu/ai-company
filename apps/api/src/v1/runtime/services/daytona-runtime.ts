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
import { buildEnvPrefix, shellEscape } from '../runtime.utils';
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

/** Fixed poll interval for the safety-net poller (ms). */
const POLL_INTERVAL_MS = 200;

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
      cmdString = `cd ${shellEscape(params.cwd)} && ${cmdString}`;
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
   * 2. **Fixed-interval polling** (200ms) — safety net for fast-exiting commands
   *    whose WebSocket close may be delayed.
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
    let streamActive = true;

    return new Promise<RuntimeExecResult>((resolve) => {
      let settled = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;

      const fetchExitCode = async (): Promise<number> => {
        try {
          const cmd = await this.sandbox!.process.getSessionCommand(
            sessionId,
            cmdId,
          );
          if (typeof cmd.exitCode === 'number') return cmd.exitCode;
        } catch {
          // cmdId not found — cleaned up after fast exit
        }
        return stderr.length > 0 ? 1 : 0;
      };

      const settle = (result: RuntimeExecResult) => {
        if (settled) return;
        settled = true;
        streamActive = false;
        if (pollInterval !== null) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        resolve(result);
      };

      const settleWithStuckHandler = (result: RuntimeExecResult) => {
        if (settled) return;
        settle(onSessionStuck ? onSessionStuck(result) : result);
      };

      // Stream: primary completion signal
      void this.sandbox!.process.getSessionCommandLogs(
        sessionId,
        cmdId,
        (chunk: string) => {
          if (!streamActive) return;
          stdout += chunk;
          lastOutputAt = Date.now();
        },
        (chunk: string) => {
          if (!streamActive) return;
          stderr += chunk;
          lastOutputAt = Date.now();
        },
      )
        .then(async () => {
          if (settled) return;
          const exitCode = await fetchExitCode();
          settle({
            exitCode,
            stdout,
            stderr,
            fail: exitCode !== 0,
            execPath: fullWorkdir,
          });
        })
        .catch(() => {
          /* stream error on session kill — expected */
        });

      // Poll: safety net for fast-exiting commands whose WebSocket close is delayed
      pollInterval = setInterval(() => {
        if (settled) return;

        void (async () => {
          // Abort signal check
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

          const now = Date.now();

          // Idle timeout
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

          // Hard timeout
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

          // Check command status
          let cmd: { exitCode?: number } | undefined;
          try {
            cmd = await this.sandbox!.process.getSessionCommand(
              sessionId,
              cmdId,
            );
          } catch {
            // 404: cmdId cleaned up — fast exit; infer from output
            settle({
              exitCode: stderr.length > 0 ? 1 : 0,
              stdout,
              stderr,
              fail: stderr.length > 0,
              execPath: fullWorkdir,
            });
            return;
          }

          if (cmd && typeof cmd.exitCode === 'number') {
            streamActive = false;
            settle({
              exitCode: cmd.exitCode,
              stdout,
              stderr,
              fail: cmd.exitCode !== 0,
              execPath: fullWorkdir,
            });
          }
        })();
      }, POLL_INTERVAL_MS);
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

  private static stripAnsi(str: string): string {
    /* eslint-disable no-control-regex */
    return str
      .replace(
        /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
        '',
      )
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    /* eslint-enable no-control-regex */
  }

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
    if (!this.sandbox) {
      throw new Error('Runtime not started');
    }

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    const cwd = options?.workdir || this.workdir;
    const envPrefix = buildEnvPrefix(options?.env);
    const escapedArgs = command.map(shellEscape);
    const cmd = `${envPrefix}${escapedArgs.join(' ')}`;
    let accumulated = '';

    const ptyId = `pty-${randomUUID()}`;
    this.activeSessions.add(ptyId);
    const ptyHandle = await this.sandbox.process.createPty({
      id: ptyId,
      cwd,
      envs: { SHELL: '/bin/sh', TERM: 'xterm-256color', ...options?.env },
      cols: 220,
      rows: 50,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data);
        const stripped = DaytonaRuntime.stripAnsi(text);
        if (stripped) {
          accumulated += stripped;
          stdoutStream.write(stripped);
        }
      },
    });

    await ptyHandle.waitForConnection();

    // Send the command to the PTY shell
    await ptyHandle.sendInput(cmd + '\n');

    // Wait for completion in the background and handle exit
    void ptyHandle
      .wait()
      .then((result) => {
        const exitCode = result.exitCode ?? 0;
        if (exitCode !== 0 && accumulated) {
          stderrStream.write(accumulated);
        }
        stderrStream.end();
        stdoutStream.end();
      })
      .catch(() => {
        stderrStream.end();
        stdoutStream.end();
      });

    const stdinDuplex = new Duplex({
      write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        void ptyHandle
          .sendInput(chunk.toString())
          .then(() => callback())
          .catch((err: Error) => callback(err));
      },
      read() {
        // No-op — stdin is write-only from the caller's perspective
      },
    });

    const close = () => {
      this.activeSessions.delete(ptyId);
      void ptyHandle
        .kill()
        .catch(() => {})
        .then(() => ptyHandle.disconnect());
    };

    return {
      stdin: stdinDuplex,
      stdout: stdoutStream,
      stderr: stderrStream,
      close,
    };
  }
}
