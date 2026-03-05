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
const IDLE_TIMEOUT_MS = 60_000;

/** Absolute wall-clock limit; overridden by params.timeoutMs when provided. */
const HARD_TIMEOUT_MS = 3_600_000;

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

    try {
      const commonParams = {
        name: sandboxName,
        envVars: params?.env,
        labels: params?.labels,
        // Disable auto-stop so long-running sandbox stays alive
        autoStopInterval: 0,
      };

      let sandbox: Sandbox;
      if (snapshotOrImage) {
        // Use `image` — Daytona automatically builds a snapshot from the
        // Docker image on first use and caches it in the transient registry.
        // Subsequent sandbox creations reuse the cached snapshot.
        // Note: we intentionally omit `onSnapshotCreateLogs` because the
        // build-logs URL requires a correctly configured PROXY_TEMPLATE_URL.
        // The SDK still waits for the sandbox to reach `started` state.
        sandbox = await this.daytona.create(
          { ...commonParams, image: snapshotOrImage },
          { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
        );
      } else {
        sandbox = await this.daytona.create(commonParams, {
          timeout: SANDBOX_CREATE_TIMEOUT_SECONDS,
        });
      }

      this.sandbox = sandbox;

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
        await this.recreateSession(params.sessionId);

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

    // Non-session execution
    try {
      const timeoutSeconds = params.timeoutMs
        ? Math.ceil(params.timeoutMs / 1000)
        : 0;

      const execPromise = this.sandbox.process.executeCommand(
        cmdString,
        undefined, // cwd handled by cd prefix
        params.env,
        timeoutSeconds || undefined,
      );

      // Race against abort signal if provided
      const response = await this.raceWithAbort(execPromise, params.signal);

      if (response === 'aborted') {
        const result: RuntimeExecResult = {
          exitCode: 124,
          stdout: '',
          stderr: 'Aborted',
          fail: true,
          execPath: fullWorkdir,
        };
        this.emit({
          type: 'execEnd',
          data: { execId, params, result },
        });
        return result;
      }

      const exitCode = response.exitCode;
      const stdout = response.result ?? '';
      // executeCommand returns a single `result` string with stdout and stderr
      // interleaved. The SDK's ExecuteResponse type has no separate stderr field.
      // Session-based execution (executeSessionCommand) does demux stdout/stderr.
      const stderr = '';

      const result: RuntimeExecResult = {
        exitCode,
        stdout,
        stderr,
        fail: exitCode !== 0,
        execPath: fullWorkdir,
      };

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
    }

    // Build env prefix same as Docker runtime
    const envPrefix = this.buildEnvPrefix(params.env);
    const script = `${envPrefix}${cmdString || ':'}`;

    // Launch command asynchronously so we can detect hangs
    const { cmdId } = await this.sandbox!.process.executeSessionCommand(
      sessionId,
      { command: script, runAsync: true },
    );

    const hardMs = Math.min(params.timeoutMs ?? HARD_TIMEOUT_MS, HARD_TIMEOUT_MS);
    const startAt = Date.now();
    let lastOutputAt = Date.now();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let streamActive = true;

    // Stream logs — callbacks update lastOutputAt and collect output.
    // Fire-and-forget: stream errors on early session kill are expected and intentionally silent.
    void this.sandbox!.process.getSessionCommandLogs(
      sessionId,
      cmdId,
      (chunk: string) => {
        if (!streamActive) return;
        stdoutChunks.push(chunk);
        lastOutputAt = Date.now();
      },
      (chunk: string) => {
        if (!streamActive) return;
        stderrChunks.push(chunk);
        lastOutputAt = Date.now();
      },
    ).catch(() => {});

    return new Promise<RuntimeExecResult>((resolve) => {
      let settled = false;

      const settle = (result: RuntimeExecResult) => {
        if (settled) return;
        settled = true;
        streamActive = false;
        clearInterval(check);
        resolve(result);
      };

      const settleWithRecreate = (result: RuntimeExecResult) => {
        if (settled) return;
        // Start session recreation and store the promise so the next
        // execInSession call can await it before using the session.
        this.sessionRecreatePromise = this.recreateSession(sessionId);
        settle(result);
      };

      const check = setInterval(() => {
        // Abort signal — synchronous check at the top of each tick
        if (params.signal?.aborted) {
          settleWithRecreate({
            exitCode: 124,
            stdout: stdoutChunks.join(''),
            stderr: 'Aborted',
            fail: true,
            execPath: fullWorkdir,
          });
          return;
        }

        const now = Date.now();

        // Idle timeout — no output for IDLE_TIMEOUT_MS
        if (now - lastOutputAt >= IDLE_TIMEOUT_MS) {
          settleWithRecreate({
            exitCode: 124,
            stdout: stdoutChunks.join(''),
            stderr: `Idle timeout: no output for ${IDLE_TIMEOUT_MS / 1000}s`,
            fail: true,
            execPath: fullWorkdir,
          });
          return;
        }

        // Hard timeout — wall-clock limit exceeded
        if (now - startAt >= hardMs) {
          settleWithRecreate({
            exitCode: 124,
            stdout: stdoutChunks.join(''),
            stderr: `Hard timeout: command exceeded ${hardMs / 1000}s`,
            fail: true,
            execPath: fullWorkdir,
          });
          return;
        }

        // Poll command status — async, errors caught silently
        this.sandbox!.process.getSessionCommand(sessionId, cmdId)
          .then(async (cmd) => {
            if (typeof cmd.exitCode === 'number') {
              const finalExitCode = cmd.exitCode;
              clearInterval(check);
              streamActive = false;

              // Fetch complete logs synchronously to avoid race with streaming callbacks.
              // The streaming getSessionCommandLogs may not have delivered all chunks yet.
              let stdout = stdoutChunks.join('');
              let stderr = stderrChunks.join('');
              try {
                const logs = await this.sandbox!.process.getSessionCommandLogs(
                  sessionId,
                  cmdId,
                ) as { stdout?: string; stderr?: string };
                if (logs.stdout) stdout = logs.stdout;
                if (logs.stderr) stderr = logs.stderr;
              } catch {
                // Fallback to whatever the stream collected
              }

              settle({
                exitCode: finalExitCode,
                stdout,
                stderr,
                fail: finalExitCode !== 0,
                execPath: fullWorkdir,
              });
            }
          })
          .catch(() => {
            // Transient poll failures should not crash the loop — polling continues.
          });
      }, 2000);
    });
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

  private async raceWithAbort<T>(
    promise: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T | 'aborted'> {
    if (!signal) {
      return promise;
    }

    if (signal.aborted) {
      return 'aborted';
    }

    return new Promise<T | 'aborted'>((resolve, reject) => {
      const onAbort = () => resolve('aborted');
      signal.addEventListener('abort', onAbort, { once: true });

      promise
        .then((value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        })
        .catch((error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  private buildEnvPrefix(env?: Record<string, string>) {
    if (!env || !Object.keys(env).length) {
      return '';
    }

    const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
    return `${Object.entries(env)
      .filter(([k]) => safeKeyPattern.test(k))
      .map(([k, v]) => `export ${k}=${this.shellEscape(v)}`)
      .join('; ')}; `;
  }

  private shellEscape(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
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
