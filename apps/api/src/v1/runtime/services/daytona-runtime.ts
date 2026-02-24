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
        // Determine if this looks like a Docker image (contains : or /) or a snapshot name
        const isDockerImage =
          snapshotOrImage.includes(':') || snapshotOrImage.includes('/');
        if (isDockerImage) {
          sandbox = await this.daytona.create(
            { ...commonParams, image: snapshotOrImage },
            { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
          );
        } else {
          sandbox = await this.daytona.create(
            { ...commonParams, snapshot: snapshotOrImage },
            { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
          );
        }
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

  private async execInSession(
    params: RuntimeExecParams,
    cmdString: string,
  ): Promise<RuntimeExecResult> {
    const sessionId = params.sessionId as string;
    const fullWorkdir = this.getWorkdir(params.cwd) || this.workdir;

    // Ensure session exists
    if (!this.activeSessions.has(sessionId)) {
      await this.sandbox!.process.createSession(sessionId);
      this.activeSessions.add(sessionId);
    }

    // Build env prefix same as Docker runtime
    const envPrefix = this.buildEnvPrefix(params.env);
    const script = `${envPrefix}${cmdString || ':'}`;

    const timeoutSeconds = params.timeoutMs
      ? Math.ceil(params.timeoutMs / 1000)
      : 0;

    const execPromise = this.sandbox!.process.executeSessionCommand(
      sessionId,
      { command: script },
      timeoutSeconds || undefined,
    );

    // Race against abort signal if provided
    const response = await this.raceWithAbort(execPromise, params.signal);

    if (response === 'aborted') {
      // Session is likely corrupted after abort — recreate it
      await this.recreateSession(sessionId);
      return {
        exitCode: 124,
        stdout: '',
        stderr: 'Aborted',
        fail: true,
        execPath: fullWorkdir,
      };
    }

    const exitCode = response.exitCode ?? 1;
    const stdout = response.stdout ?? response.output ?? '';
    const stderr = response.stderr ?? '';

    return {
      exitCode,
      stdout,
      stderr,
      fail: exitCode !== 0,
      execPath: fullWorkdir,
    };
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
