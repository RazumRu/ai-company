import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../notifications/notifications.types';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';
import { DaytonaRuntime } from './daytona-runtime';
import { DockerRuntime } from './docker-runtime';
import { RuntimeProvider } from './runtime-provider';

const mockSandbox = {
  id: 'sandbox-1',
  name: 'test-sandbox',
  state: 'started',
  process: {
    executeCommand: vi.fn(),
    createSession: vi.fn(),
    executeSessionCommand: vi.fn(),
    getSessionCommand: vi.fn(),
    getSessionCommandLogs: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    createPty: vi.fn(),
  },
};

const mockDaytonaInstance = {
  create: vi.fn().mockResolvedValue(mockSandbox),
  findOne: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@daytonaio/sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@daytonaio/sdk')>();

  const MockDaytona = vi.fn(function (this: typeof mockDaytonaInstance) {
    Object.assign(this, mockDaytonaInstance);
  }) as unknown as typeof original.Daytona;

  return {
    ...original,
    Daytona: MockDaytona,
  };
});

describe('DaytonaRuntime', () => {
  let runtime: DaytonaRuntime;

  beforeEach(() => {
    runtime = new DaytonaRuntime({
      apiKey: 'key',
      apiUrl: 'http://api',
      target: 'us',
    });
    // Inject sandbox directly to bypass start()
    (runtime as unknown as { sandbox: typeof mockSandbox }).sandbox =
      mockSandbox;

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('exec()', () => {
    /** Set up mocks for one-shot async execution. */
    function setupOneShotMocks(overrides?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      cmdId?: string;
    }) {
      const cmdId = overrides?.cmdId ?? 'oneshot-cmd-1';
      const exitCode = overrides?.exitCode ?? 0;
      const stdout = overrides?.stdout ?? '';
      const stderr = overrides?.stderr ?? '';

      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({ cmdId });
      // Streaming overload: never resolves (pending), snapshot overload returns logs
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout, stderr });
          }
          return new Promise<void>(() => undefined);
        },
      );
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode,
        id: cmdId,
        command: 'test',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('routes through temporary session for one-shot execution', async () => {
      setupOneShotMocks({ stdout: 'hello' });

      const execPromise = runtime.exec({ cmd: 'echo hello' });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(mockSandbox.process.createSession).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
      );
      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
        expect.objectContaining({
          command: 'echo hello',
          runAsync: true,
        }),
        undefined,
      );
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
      );
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it('prepends cd command when cwd is provided', async () => {
      setupOneShotMocks({ stdout: '/app/src' });

      const execPromise = runtime.exec({
        cmd: 'pwd',
        cwd: '/app/src',
      });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
        expect.objectContaining({
          command: expect.stringContaining("cd '/app/src'"),
          runAsync: true,
        }),
        undefined,
      );
      expect(result.fail).toBe(false);
    });

    it('passes env via buildEnvPrefix in one-shot execution', async () => {
      setupOneShotMocks({ stdout: 'ok' });

      const execPromise = runtime.exec({
        cmd: 'echo $FOO',
        env: { FOO: 'bar' },
      });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
        expect.objectContaining({
          command: expect.stringContaining("export FOO='bar'"),
          runAsync: true,
        }),
        undefined,
      );
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it('returns non-zero exit code for failing one-shot commands', async () => {
      setupOneShotMocks({ exitCode: 1, stderr: 'command not found' });

      const execPromise = runtime.exec({ cmd: 'notacommand' });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it('returns aborted result when abort signal fires during one-shot execution', async () => {
      const controller = new AbortController();

      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'oneshot-abort-cmd',
      });
      // Stream never resolves
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: '', stderr: '' });
          }
          return new Promise<void>(() => undefined);
        },
      );
      // Command never completes
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'oneshot-abort-cmd',
        command: 'sleep 60',
      });

      controller.abort();

      const execPromise = runtime.exec({
        cmd: 'sleep 60',
        signal: controller.signal,
      });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
      );
    });
  });

  describe('session-based exec()', () => {
    /** Set up mocks for async session execution and advance the polling interval. */
    function setupAsyncSessionMocks(overrides?: {
      exitCode?: number;
      cmdId?: string;
    }) {
      const cmdId = overrides?.cmdId ?? 'cmd-1';
      const exitCode = overrides?.exitCode ?? 0;

      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({ cmdId });
      mockSandbox.process.getSessionCommandLogs.mockResolvedValue(undefined);
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode,
        id: cmdId,
        command: 'test',
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('creates session on first call and routes through executeSessionCommand', async () => {
      setupAsyncSessionMocks();

      const execPromise = runtime.exec({
        cmd: 'echo test',
        sessionId: 'sess-1',
      });

      // Advance past the 2s polling interval
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(mockSandbox.process.createSession).toHaveBeenCalledWith('sess-1');
      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          command: expect.any(String),
          runAsync: true,
        }),
      );
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
    });

    it('does not recreate session on subsequent calls', async () => {
      setupAsyncSessionMocks();

      const p1 = runtime.exec({ cmd: 'echo 1', sessionId: 'sess-reuse' });
      await vi.advanceTimersByTimeAsync(2500);
      await p1;

      setupAsyncSessionMocks();

      const p2 = runtime.exec({ cmd: 'echo 2', sessionId: 'sess-reuse' });
      await vi.advanceTimersByTimeAsync(2500);
      await p2;

      expect(mockSandbox.process.createSession).toHaveBeenCalledTimes(1);
      // init (once on first creation) + echo 1 + echo 2 = 3
      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledTimes(
        3,
      );
    });

    it('prepends cd command for cwd in session execution', async () => {
      setupAsyncSessionMocks();

      const execPromise = runtime.exec({
        cmd: 'ls',
        sessionId: 'sess-cwd',
        cwd: '/workspace',
      });

      await vi.advanceTimersByTimeAsync(2500);
      await execPromise;

      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        'sess-cwd',
        expect.objectContaining({
          command: expect.stringContaining("cd '/workspace'"),
          runAsync: true,
        }),
      );
    });

    describe('session workdir initialisation', () => {
      it('runs mkdir + cd to /runtime-workspace synchronously when session is created', async () => {
        setupAsyncSessionMocks();

        const execPromise = runtime.exec({
          cmd: 'echo test',
          sessionId: 'sess-init-cwd',
        });

        await vi.advanceTimersByTimeAsync(2500);
        await execPromise;

        // First executeSessionCommand call must be the workdir init (runAsync: false)
        expect(
          mockSandbox.process.executeSessionCommand,
        ).toHaveBeenNthCalledWith(1, 'sess-init-cwd', {
          command: 'mkdir -p /runtime-workspace && cd /runtime-workspace',
          runAsync: false,
        });
        // Second call is the actual user command (runAsync: true)
        expect(
          mockSandbox.process.executeSessionCommand,
        ).toHaveBeenNthCalledWith(
          2,
          'sess-init-cwd',
          expect.objectContaining({
            command: 'echo test',
            runAsync: true,
          }),
        );
      });

      it('does not re-initialise CWD on session reuse', async () => {
        setupAsyncSessionMocks();

        const p1 = runtime.exec({ cmd: 'cmd1', sessionId: 'sess-init-reuse' });
        await vi.advanceTimersByTimeAsync(2500);
        await p1;

        setupAsyncSessionMocks();

        const p2 = runtime.exec({ cmd: 'cmd2', sessionId: 'sess-init-reuse' });
        await vi.advanceTimersByTimeAsync(2500);
        await p2;

        // createSession called only once — session reused
        expect(mockSandbox.process.createSession).toHaveBeenCalledTimes(1);
        // init (1) + cmd1 (1) + cmd2 (1) = 3 total
        expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledTimes(
          3,
        );
        // The init command was only sent once (the very first call)
        const initCalls =
          mockSandbox.process.executeSessionCommand.mock.calls.filter(
            (args: unknown[]) => {
              const opts = args[1] as { command: string };
              return opts.command.includes('mkdir -p /runtime-workspace');
            },
          );
        expect(initCalls).toHaveLength(1);
      });

      it('swallows workdir init failure and still executes the command', async () => {
        let callCount = 0;
        mockSandbox.process.createSession.mockResolvedValue(undefined);
        mockSandbox.process.executeSessionCommand.mockImplementation(
          (_sessionId: string, opts: { runAsync: boolean }) => {
            callCount++;
            if (callCount === 1 && !opts.runAsync) {
              // Init call fails
              return Promise.reject(new Error('init mkdir failed'));
            }
            return Promise.resolve({ cmdId: 'cmd-fallback' });
          },
        );
        mockSandbox.process.getSessionCommandLogs.mockResolvedValue(undefined);
        mockSandbox.process.getSessionCommand.mockResolvedValue({
          exitCode: 0,
          id: 'cmd-fallback',
          command: 'test',
        });

        const execPromise = runtime.exec({
          cmd: 'test',
          sessionId: 'sess-init-fail',
        });

        await vi.advanceTimersByTimeAsync(2500);
        const result = await execPromise;

        // Command succeeds despite init failure
        expect(result.fail).toBe(false);
        expect(result.exitCode).toBe(0);
        // Both init (failed) and real command were attempted
        expect(callCount).toBe(2);
      });
    });
  });

  describe('execStream()', () => {
    function createMockPtyHandle(overrides?: {
      exitCode?: number;
      onDataCb?: (fn: (data: Uint8Array) => void) => void;
    }) {
      let onDataFn: ((data: Uint8Array) => void) | undefined;
      let waitResolve: ((result: { exitCode?: number }) => void) | undefined;

      const handle = {
        waitForConnection: vi.fn().mockResolvedValue(undefined),
        sendInput: vi.fn().mockResolvedValue(undefined),
        kill: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn(
          () =>
            new Promise<{ exitCode?: number }>((resolve) => {
              waitResolve = resolve;
            }),
        ),
      };

      mockSandbox.process.createPty.mockImplementation(
        (opts: { onData: (data: Uint8Array) => void }) => {
          onDataFn = opts.onData;
          overrides?.onDataCb?.(onDataFn);
          return Promise.resolve(handle);
        },
      );

      return {
        handle,
        emitData: (text: string) => onDataFn?.(new TextEncoder().encode(text)),
        resolveWait: (exitCode?: number) =>
          waitResolve?.({ exitCode: exitCode ?? overrides?.exitCode ?? 0 }),
      };
    }

    it('throws when sandbox is not started', async () => {
      const unstartedRuntime = new DaytonaRuntime({
        apiKey: 'k',
        apiUrl: 'http://api',
        target: 'us',
      });
      await expect(unstartedRuntime.execStream(['ls'])).rejects.toThrow(
        'Runtime not started',
      );
    });

    it('returns stdin/stdout/stderr streams and calls createPty', async () => {
      const pty = createMockPtyHandle();

      const { stdin, stdout, stderr, close } = await runtime.execStream(
        ['echo', 'hello'],
        { workdir: '/test' },
      );

      expect(mockSandbox.process.createPty).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/test',
          cols: 220,
          rows: 50,
          envs: expect.objectContaining({ TERM: 'xterm-256color' }),
        }),
      );
      expect(pty.handle.waitForConnection).toHaveBeenCalled();
      expect(pty.handle.sendInput).toHaveBeenCalledWith("'echo' 'hello'\n");

      // Simulate PTY output
      pty.emitData('hello\n');

      const chunks: string[] = [];
      stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

      // Resolve wait to end streams
      pty.resolveWait(0);
      await new Promise<void>((r) => stdout.on('end', r));

      expect(chunks.join('')).toContain('hello');
      expect(stdin).toBeDefined();
      expect(stderr).toBeDefined();
      expect(close).toBeInstanceOf(Function);
    });

    it('strips ANSI escape codes from PTY output', async () => {
      const pty = createMockPtyHandle();

      const { stdout } = await runtime.execStream(['echo', 'test']);

      const chunks: string[] = [];
      stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

      pty.emitData('\x1b[32mgreen text\x1b[0m\n');

      pty.resolveWait(0);
      await new Promise<void>((r) => stdout.on('end', r));

      expect(chunks.join('')).toBe('green text\n');
    });

    it('close() terminates PTY and ends streams', async () => {
      const pty = createMockPtyHandle();

      const { close } = await runtime.execStream(['ls']);

      close();

      // Allow microtasks to flush
      await new Promise<void>((r) => setImmediate(r));

      expect(pty.handle.kill).toHaveBeenCalled();
    });

    it('routes output to stderr on non-zero exit', async () => {
      const pty = createMockPtyHandle();

      const { stderr } = await runtime.execStream(['failing-cmd']);

      const stderrChunks: string[] = [];
      stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

      pty.emitData('error output\n');

      pty.resolveWait(1);
      await new Promise<void>((r) => stderr.on('end', r));

      expect(stderrChunks.join('')).toContain('error output');
    });
  });

  describe('stop()', () => {
    it('cleans up sandbox and sessions', async () => {
      vi.useFakeTimers();

      // Add a session via async exec
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-cleanup',
      });
      mockSandbox.process.getSessionCommandLogs.mockResolvedValue(undefined);
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode: 0,
        id: 'cmd-cleanup',
        command: 'echo 1',
      });

      const execPromise = runtime.exec({
        cmd: 'echo 1',
        sessionId: 'sess-cleanup',
      });
      await vi.advanceTimersByTimeAsync(2500);
      await execPromise;

      // Set up daytona mock for delete
      const mockDaytona = { delete: vi.fn().mockResolvedValue(undefined) };
      (runtime as unknown as { daytona: typeof mockDaytona }).daytona =
        mockDaytona;

      await runtime.stop();

      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-cleanup',
      );
      expect(mockDaytona.delete).toHaveBeenCalledWith(mockSandbox);

      vi.useRealTimers();
    });
  });

  describe('abort signal handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);
      // Stream never resolves; snapshot overload returns empty output
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: '', stderr: '' });
          }
          return new Promise<void>(() => undefined);
        },
      );
      // Command never completes
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'abort-cmd',
        command: 'sleep 60',
      });
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'abort-cmd',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns aborted result when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const execPromise = runtime.exec({
        cmd: 'sleep 60',
        signal: abortController.signal,
      });

      // Advance past the first poll tick — abort is detected in the interval
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
    });

    it('returns aborted result when signal fires during execution', async () => {
      const abortController = new AbortController();

      const execPromise = runtime.exec({
        cmd: 'sleep 60',
        signal: abortController.signal,
      });

      // Command is running — no abort yet; advance past first poll
      await vi.advanceTimersByTimeAsync(2500);

      // Abort mid-execution
      abortController.abort();

      // Advance to next poll tick so the abort is detected
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
    });
  });

  describe('start()', () => {
    let freshRuntime: DaytonaRuntime;

    beforeEach(() => {
      freshRuntime = new DaytonaRuntime({
        apiKey: 'key',
        apiUrl: 'http://api',
        target: 'us',
      });
      mockDaytonaInstance.create.mockResolvedValue(mockSandbox);
      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.delete.mockResolvedValue(undefined);
    });

    it('calls daytona.create() with correct params', async () => {
      await freshRuntime.start({
        containerName: 'my-sandbox',
        image: 'node:20',
        env: { NODE_ENV: 'test' },
        labels: { team: 'backend' },
      });

      expect(mockDaytonaInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-sandbox',
          image: 'node:20',
          envVars: { NODE_ENV: 'test' },
          labels: { team: 'backend' },
          autoStopInterval: 0,
        }),
        { timeout: 300 },
      );
    });

    it('is idempotent — calling twice does not create a second sandbox', async () => {
      await freshRuntime.start({ containerName: 'idempotent-sandbox' });
      await freshRuntime.start({ containerName: 'idempotent-sandbox' });

      expect(mockDaytonaInstance.create).toHaveBeenCalledTimes(1);
    });

    it('with recreate: true deletes existing sandbox first', async () => {
      const existingSandbox = { ...mockSandbox, id: 'existing-1' };
      mockDaytonaInstance.findOne.mockResolvedValue(existingSandbox);

      await freshRuntime.start({
        containerName: 'recreate-sandbox',
        recreate: true,
      });

      expect(mockDaytonaInstance.findOne).toHaveBeenCalledWith({
        idOrName: 'recreate-sandbox',
      });
      expect(mockDaytonaInstance.delete).toHaveBeenCalledWith(existingSandbox);
      expect(mockDaytonaInstance.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('exec guard', () => {
    it('throws when exec is called before start', async () => {
      const unstartedRuntime = new DaytonaRuntime({
        apiKey: 'k',
        apiUrl: 'http://api',
        target: 'us',
      });
      await expect(unstartedRuntime.exec({ cmd: 'echo hi' })).rejects.toThrow(
        'Runtime not started',
      );
    });
  });

  describe('async session exec — timeout and abort scenarios', () => {
    function mockStreamingLogsWithoutSnapshots() {
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
          _onStderr?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({});
          }
          return new Promise<void>(() => undefined);
        },
      );
    }

    beforeEach(() => {
      vi.useFakeTimers();
      mockSandbox.process.createSession.mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('scenario 1: normal completion — getSessionCommand returns exitCode on first poll', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-1',
      });
      mockSandbox.process.getSessionCommandLogs.mockResolvedValue(undefined);
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode: 0,
        id: 'cmd-1',
        command: 'echo hello',
      });

      const execPromise = runtime.exec({
        cmd: 'echo hello',
        sessionId: 'sess-normal',
      });

      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.exitCode).toBe(0);
      expect(result.fail).toBe(false);
    });

    it('scenario 2: idle timeout fires when no output is produced', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-2',
      });
      // Log stream never calls callbacks (no output)
      mockStreamingLogsWithoutSnapshots();
      // Command never completes
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-2',
        command: 'hang',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'hang',
        sessionId: 'sess-idle',
      });

      // Advance past the 300s idle timeout
      await vi.advanceTimersByTimeAsync(302_000);
      const result = await execPromise;

      expect(result.exitCode).toBe(124);
      expect(result.fail).toBe(true);
      expect(result.stderr).toContain('Idle timeout');
      // recreateSession calls deleteSession + createSession
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-idle',
      );
    });

    it('scenario 3: hard timeout fires when output continues but command never completes', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-3',
      });
      // Simulate periodic output by calling onStdout via setInterval in mock
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({});
          }
          const outputInterval = setInterval(() => {
            onStdout('output chunk\n');
          }, 5000);
          return new Promise<void>((_resolve, _reject) => {
            // Never resolves; clean up the interval when the test ends
            // (fake timers will handle this)
            void outputInterval;
          }).catch(() => {});
        },
      );
      // Command never completes
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-3',
        command: 'long-running',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'long-running',
        sessionId: 'sess-hard',
        timeoutMs: 10_000,
      });

      // Advance past the 10s hard timeout
      await vi.advanceTimersByTimeAsync(12_000);
      const result = await execPromise;

      expect(result.exitCode).toBe(124);
      expect(result.fail).toBe(true);
      expect(result.stderr).toContain('Hard timeout');
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-hard',
      );
    });

    it('scenario 4: explicit timeoutMs used as hard timeout — error message contains caller-provided value', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-4',
      });
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({});
          }
          const outputInterval = setInterval(() => {
            onStdout('keep alive\n');
          }, 3000);
          return new Promise<void>(() => {
            void outputInterval;
          }).catch(() => {});
        },
      );
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-4',
        command: 'test',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-explicit',
        timeoutMs: 10_000,
      });

      await vi.advanceTimersByTimeAsync(12_000);
      const result = await execPromise;

      expect(result.stderr).toContain('10s');
      expect(result.stderr).not.toContain('3600s');
    });

    it('scenario 5: abort signal terminates polling', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-5',
      });
      mockStreamingLogsWithoutSnapshots();
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-5',
        command: 'test',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const controller = new AbortController();
      controller.abort();

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-abort',
        signal: controller.signal,
      });

      // Advance past first polling tick
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
      expect(result.fail).toBe(true);
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-abort',
      );
    });

    it('scenario 5b: mid-poll abort terminates session and returns accumulated output', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-5b',
      });
      // Emit some output before abort so we can verify it's included
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: 'partial output\n', stderr: '' });
          }
          // Emit output immediately so stdoutChunks has content
          onStdout('partial output\n');
          return new Promise<void>(() => {}).catch(() => {});
        },
      );
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-5b',
        command: 'test',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const controller = new AbortController();

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-abort-mid',
        signal: controller.signal,
      });

      // Advance past the first poll tick (2s) — exec is running normally
      await vi.advanceTimersByTimeAsync(2500);

      // Fire abort mid-execution
      controller.abort();

      // Advance to the next poll tick so the abort is detected
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
      expect(result.fail).toBe(true);
      expect(result.stdout).toContain('partial output');
      // recreateSession calls deleteSession
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-abort-mid',
      );
    });

    it('scenario 6: transient getSessionCommand failure — polling continues past error', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-6',
      });
      mockSandbox.process.getSessionCommandLogs.mockResolvedValue(undefined);

      let callCount = 0;
      mockSandbox.process.getSessionCommand.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Network blip'));
        }
        return Promise.resolve({
          exitCode: 0,
          id: 'cmd-6',
          command: 'test',
        });
      });

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-transient',
      });

      // First poll at 2s — fails transiently
      await vi.advanceTimersByTimeAsync(2500);
      // Second poll at 4s — succeeds
      await vi.advanceTimersByTimeAsync(2500);
      const result = await execPromise;

      expect(result.exitCode).toBe(0);
      expect(result.fail).toBe(false);
    });

    it('scenario 7: periodic output prevents idle timeout', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-7',
      });

      // Emit output every 30s to keep the idle timer fresh (well within the 300s idle limit)
      // Handle both overloads: streaming (4 args) and synchronous fetch (2 args)
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          // Synchronous fetch overload (2 args) — return collected output
          if (!onStdout) {
            return Promise.resolve({ stdout: 'progress\n', stderr: '' });
          }
          // Streaming overload (4 args)
          const outputInterval = setInterval(() => {
            onStdout('progress\n');
          }, 30_000);
          return new Promise<void>(() => {
            void outputInterval;
          }).catch(() => {});
        },
      );

      // Return no exitCode for enough polls that 90s+ wall time passes,
      // then return exitCode: 0. At 2s poll interval, 45 polls = 90s.
      let pollCount = 0;
      mockSandbox.process.getSessionCommand.mockImplementation(() => {
        pollCount++;
        if (pollCount < 46) {
          return Promise.resolve({ id: 'cmd-7', command: 'test' });
        }
        return Promise.resolve({
          exitCode: 0,
          id: 'cmd-7',
          command: 'test',
        });
      });

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-output',
      });

      // Advance 120s — without periodic output resetting the idle timer,
      // this would eventually trigger idle timeout (300s).
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await execPromise;

      // Command completes normally — proving output kept resetting the idle timer
      expect(result.exitCode).toBe(0);
      expect(result.fail).toBe(false);
    });

    it('scenario 8: idle timeout fires before hard timeout', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-8',
      });
      // No output produced
      mockStreamingLogsWithoutSnapshots();
      // Command never completes
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-8',
        command: 'test',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'test',
        sessionId: 'sess-idle-vs-hard',
        timeoutMs: 600_000,
      });

      // Advance 302s — idle timeout (300s) should fire before hard timeout (600s)
      await vi.advanceTimersByTimeAsync(302_000);
      const result = await execPromise;

      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain('Idle timeout');
      expect(result.stderr).not.toContain('Hard timeout');
    });

    it('scenario 9a: returns failure immediately when command exits instantly (no idle timeout)', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-fast-fail',
      });

      // Streaming getSessionCommandLogs hangs forever; snapshot returns empty
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: '', stderr: '' });
          }
          return new Promise<void>(() => undefined);
        },
      );

      // getSessionCommand returns exitCode: 127 immediately
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode: 127,
        id: 'cmd-fast-fail',
        command: 'bun install',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'bun install',
        sessionId: 'sess-fast-fail',
        idleTimeoutMs: 15_000,
      });

      // Fixed poll at 200ms — the exit code should be detected quickly
      await vi.advanceTimersByTimeAsync(500);
      const result = await execPromise;

      expect(result.exitCode).toBe(127);
      expect(result.fail).toBe(true);
      expect(result.stderr).not.toContain('Idle timeout');
    });

    it('scenario 9b: returns failure when stream hangs and getSessionCommand delays exitCode', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-delayed',
      });

      // Stream hangs; snapshot returns empty
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: '', stderr: '' });
          }
          return new Promise<void>(() => undefined);
        },
      );

      // First 2 polls: no exitCode. Third poll: exitCode 127.
      let pollCount = 0;
      mockSandbox.process.getSessionCommand.mockImplementation(() => {
        pollCount++;
        if (pollCount <= 2) {
          return Promise.resolve({ id: 'cmd-delayed', command: 'bun install' });
        }
        return Promise.resolve({
          exitCode: 127,
          id: 'cmd-delayed',
          command: 'bun install',
        });
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'bun install',
        sessionId: 'sess-delayed',
        idleTimeoutMs: 15_000,
      });

      // Fixed 200ms poll interval: 3 polls at 200ms each = 600ms
      await vi.advanceTimersByTimeAsync(5000);
      const result = await execPromise;

      expect(result.exitCode).toBe(127);
      expect(result.fail).toBe(true);
    });

    it('scenario 9c: one-shot returns failure immediately when command exits instantly', async () => {
      // One-shot path (no sessionId)
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'oneshot-fast-fail',
      });

      // Streaming hangs; snapshot returns empty
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (!onStdout) {
            return Promise.resolve({ stdout: '', stderr: '' });
          }
          return new Promise<void>(() => undefined);
        },
      );

      // getSessionCommand returns exitCode: 127 immediately
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode: 127,
        id: 'oneshot-fast-fail',
        command: 'bun install',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'bun install',
        idleTimeoutMs: 15_000,
      });

      // Fixed 200ms poll interval should catch it
      await vi.advanceTimersByTimeAsync(500);
      const result = await execPromise;

      expect(result.exitCode).toBe(127);
      expect(result.fail).toBe(true);
      expect(result.stderr).not.toContain('Idle timeout');
      // One-shot session should be cleaned up
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        expect.stringMatching(/^oneshot-/),
      );
    });

    it('scenario 9: fast-exit race — stream delivers stderr then getSessionCommand throws (already cleaned up)', async () => {
      const stderrOutput = 'bash: cd: /nonexistent: No such file or directory';

      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-9',
      });

      // Stream resolves after delivering stderr — simulates fast-exiting command
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          _onStdout?: (chunk: string) => void,
          onStderr?: (chunk: string) => void,
        ) => {
          if (!onStderr) {
            // Synchronous fetch overload — called from the .then() safety-net path;
            // throw so the fallback to stream-collected chunks is exercised.
            return Promise.reject(new Error('cmdId not found'));
          }
          // Streaming overload — deliver stderr then resolve
          onStderr(stderrOutput);
          return Promise.resolve();
        },
      );

      // getSessionCommand throws — cmdId already cleaned up by Daytona
      mockSandbox.process.getSessionCommand.mockRejectedValue(
        new Error('cmdId not found'),
      );

      const execPromise = runtime.exec({
        cmd: 'cd /nonexistent',
        sessionId: 'sess-fast-exit',
      });

      // Allow microtasks to flush — the stream .then() path resolves without
      // needing the polling interval to advance.
      await vi.advanceTimersByTimeAsync(0);
      const result = await execPromise;

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(stderrOutput);
    });

    it('stream resolves first — poll is irrelevant', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-stream-first',
      });

      // Stream resolves immediately with stdout
      mockSandbox.process.getSessionCommandLogs.mockImplementation(
        (
          _sessionId: string,
          _cmdId: string,
          onStdout?: (chunk: string) => void,
        ) => {
          if (onStdout) {
            onStdout('stream output\n');
          }
          return Promise.resolve();
        },
      );

      // getSessionCommand returns exitCode: 0 (called by stream .then → fetchExitCode)
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        exitCode: 0,
        id: 'cmd-stream-first',
        command: 'echo hi',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'echo hi',
        sessionId: 'sess-stream-first',
      });

      // Only flush microtasks — do NOT advance timers beyond the initial tick.
      // The stream .then() path should settle the promise without needing the poll interval.
      await vi.advanceTimersByTimeAsync(0);
      const result = await execPromise;

      expect(result.exitCode).toBe(0);
      expect(result.fail).toBe(false);
      expect(result.stdout).toBe('stream output\n');

      // getSessionCommand was called once by fetchExitCode (from stream .then path),
      // but the poll interval never fired so no additional calls were made.
      expect(mockSandbox.process.getSessionCommand).toHaveBeenCalledTimes(1);
    });

    it('onSessionStuck callback return value is used', async () => {
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        cmdId: 'cmd-stuck-cb',
      });
      mockStreamingLogsWithoutSnapshots();
      // Command never completes — no exitCode
      mockSandbox.process.getSessionCommand.mockResolvedValue({
        id: 'cmd-stuck-cb',
        command: 'sleep infinity',
      });
      mockSandbox.process.deleteSession.mockResolvedValue(undefined);

      const execPromise = runtime.exec({
        cmd: 'sleep infinity',
        sessionId: 'sess-stuck-cb',
        idleTimeoutMs: 5_000,
      });

      // Advance past the idle timeout (5s) so the stuck handler fires
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await execPromise;

      // The idle timeout fires and triggers onSessionStuck inside execInSession.
      // The default onSessionStuck in execInSession returns the result as-is
      // (it only triggers session recreation as a side-effect).
      expect(result.exitCode).toBe(124);
      expect(result.fail).toBe(true);
      expect(result.stderr).toContain('Idle timeout');
      // Verify session was recreated (deleteSession called for the stuck session)
      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-stuck-cb',
      );
      expect(mockSandbox.process.createSession).toHaveBeenCalledWith(
        'sess-stuck-cb',
      );
    });
  });
});

describe('RuntimeProvider type resolution', () => {
  it('resolveRuntimeByType(Daytona) returns DaytonaRuntime', () => {
    // Create a test subclass to access the protected method
    class TestableRuntimeProvider extends RuntimeProvider {
      public testResolveRuntimeByType(type: RuntimeType) {
        return this.resolveRuntimeByType(type);
      }
    }

    const provider = new TestableRuntimeProvider(
      {} as never,
      { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const runtime = provider.testResolveRuntimeByType(RuntimeType.Daytona);
    expect(runtime).toBeInstanceOf(DaytonaRuntime);
  });

  it('resolveRuntimeByType(Docker) still returns DockerRuntime', () => {
    class TestableRuntimeProvider extends RuntimeProvider {
      public testResolveRuntimeByType(type: RuntimeType) {
        return this.resolveRuntimeByType(type);
      }
    }

    const provider = new TestableRuntimeProvider(
      {} as never,
      { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const runtime = provider.testResolveRuntimeByType(RuntimeType.Docker);
    expect(runtime).toBeInstanceOf(DockerRuntime);
  });
});

describe('RuntimeProvider failure handling', () => {
  const mockDao = {
    getOne: vi.fn(),
    getAll: vi.fn(),
    create: vi.fn(),
    updateById: vi.fn(),
    deleteById: vi.fn(),
    hardDeleteById: vi.fn(),
  };

  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockNotificationsService = {
    emit: vi.fn().mockResolvedValue(undefined),
  };

  const baseParams = {
    graphId: 'graph-1',
    runtimeNodeId: 'node-1',
    threadId: 'thread-1',
    type: RuntimeType.Daytona,
    runtimeStartParams: { image: 'node:20' },
  };

  function buildRecord(
    overrides: Partial<RuntimeInstanceEntity> = {},
  ): RuntimeInstanceEntity {
    return {
      id: 'instance-1',
      graphId: 'graph-1',
      nodeId: 'node-1',
      threadId: 'thread-1',
      type: RuntimeType.Daytona,
      containerName: 'test-container-123',
      status: RuntimeInstanceStatus.Running,
      config: { image: 'node:20' },
      temporary: false,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as RuntimeInstanceEntity;
  }

  let provider: RuntimeProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RuntimeProvider(
      mockDao as never,
      mockLogger as never,
      mockNotificationsService as never,
    );
  });

  describe('provide() — cleans up failed runtime on ensureRuntimeForRecord failure', () => {
    it('stops container and hard-deletes record when new record creation fails', async () => {
      mockDao.getOne.mockResolvedValue(null);
      const createdRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.create.mockResolvedValue(createdRecord);
      mockDao.updateById.mockResolvedValue(undefined);
      mockDao.hardDeleteById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockRejectedValue(
        new Error('Sandbox creation timed out after 300s'),
      );

      await expect(provider.provide(baseParams)).rejects.toThrow(
        'Sandbox creation timed out after 300s',
      );

      // Should attempt to stop the container
      expect(mockDao.updateById).toHaveBeenCalledWith(createdRecord.id, {
        status: RuntimeInstanceStatus.Stopping,
      });
      // Should hard-delete the record
      expect(mockDao.hardDeleteById).toHaveBeenCalledWith(createdRecord.id);
    });

    it('stops container and hard-deletes record when existing record re-start fails', async () => {
      const existingRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.getOne.mockResolvedValue(existingRecord);
      mockDao.updateById.mockResolvedValue(undefined);
      mockDao.hardDeleteById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockRejectedValue(
        new Error('Sandbox creation timed out after 300s'),
      );

      await expect(provider.provide(baseParams)).rejects.toThrow(
        'Sandbox creation timed out after 300s',
      );

      // Should attempt to stop the container
      expect(mockDao.updateById).toHaveBeenCalledWith(existingRecord.id, {
        status: RuntimeInstanceStatus.Stopping,
      });
      // Should hard-delete the record
      expect(mockDao.hardDeleteById).toHaveBeenCalledWith(existingRecord.id);
    });
  });

  describe('provide() — handles existing Failed record', () => {
    it('cleans up Failed record and creates a fresh instance', async () => {
      const failedRecord = buildRecord({
        status: RuntimeInstanceStatus.Failed,
      });
      mockDao.getOne.mockResolvedValue(failedRecord);
      mockDao.hardDeleteById.mockResolvedValue(undefined);
      mockDao.updateById.mockResolvedValue(undefined);

      const freshRecord = buildRecord({
        id: 'instance-2',
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.create.mockResolvedValue(freshRecord);

      // Make the new creation succeed
      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockResolvedValue(mockSandbox);

      const result = await provider.provide(baseParams);

      // Should have called stopRuntime on the failed record
      expect(mockDao.updateById).toHaveBeenCalledWith(failedRecord.id, {
        status: RuntimeInstanceStatus.Stopping,
      });
      // Should have hard-deleted the failed record
      expect(mockDao.hardDeleteById).toHaveBeenCalledWith(failedRecord.id);
      // Should have created a new record
      expect(mockDao.create).toHaveBeenCalled();
      // Result should be a fresh (non-cached) runtime
      expect(result.cached).toBe(false);
    });
  });

  describe('stopRuntime()', () => {
    it('emits Stopping then Stopped with correct runtimeId', async () => {
      const record = buildRecord({ status: RuntimeInstanceStatus.Running });
      mockDao.updateById.mockResolvedValue(undefined);
      // No runtime in the runtimeInstances map — stopByName path will be taken.
      // DaytonaRuntime.stopByName uses new Daytona() internally (mocked).
      // findOne rejects → stopByName swallows the error silently.
      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));

      vi.clearAllMocks();
      mockDao.updateById.mockResolvedValue(undefined);
      mockNotificationsService.emit.mockResolvedValue(undefined);

      await provider.stopRuntime(record);

      const emitCalls = mockNotificationsService.emit.mock.calls;
      expect(emitCalls).toHaveLength(2);

      expect(emitCalls[0]![0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Stopping',
            runtimeId: record.id,
            threadId: record.threadId,
            nodeId: record.nodeId,
          }),
        }),
      );

      expect(emitCalls[1]![0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Stopped',
            runtimeId: record.id,
          }),
        }),
      );
    });
  });

  describe('cleanupIdleRuntimes() — includes Failed records', () => {
    it('queries for Failed status alongside Running and Starting', async () => {
      mockDao.getAll.mockResolvedValue([]);

      await provider.cleanupIdleRuntimes(60_000);

      expect(mockDao.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          statuses: expect.arrayContaining([
            RuntimeInstanceStatus.Running,
            RuntimeInstanceStatus.Starting,
            RuntimeInstanceStatus.Failed,
          ]),
        }),
      );
    });
  });

  describe('provide() — emits runtime status notifications', () => {
    it('emits Starting before and Running after successful new runtime creation', async () => {
      mockDao.getOne.mockResolvedValue(null);
      const createdRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.create.mockResolvedValue(createdRecord);
      mockDao.updateById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockResolvedValue(mockSandbox);

      await provider.provide(baseParams);

      const emitCalls = mockNotificationsService.emit.mock.calls;
      expect(emitCalls).toHaveLength(2);

      const startingCall = emitCalls[0]!;
      expect(startingCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          graphId: 'graph-1',
          data: expect.objectContaining({
            status: 'Starting',
            runtimeId: 'instance-1',
            nodeId: 'node-1',
            threadId: 'thread-1',
            runtimeType: RuntimeType.Daytona,
          }),
        }),
      );

      const runningCall = emitCalls[1]!;
      expect(runningCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          graphId: 'graph-1',
          data: expect.objectContaining({
            status: 'Running',
            runtimeId: 'instance-1',
            nodeId: 'node-1',
            threadId: 'thread-1',
            runtimeType: RuntimeType.Daytona,
          }),
        }),
      );
    });

    it('emits Starting then Failed with error message when creation fails', async () => {
      mockDao.getOne.mockResolvedValue(null);
      const createdRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.create.mockResolvedValue(createdRecord);
      mockDao.updateById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockRejectedValue(
        new Error('Sandbox creation timed out after 300s'),
      );

      await expect(provider.provide(baseParams)).rejects.toThrow(
        'Sandbox creation timed out after 300s',
      );

      const emitCalls = mockNotificationsService.emit.mock.calls;
      // Starting + Stopping (from cleanupFailedInstance -> stopRuntime) + Stopped + Failed
      expect(emitCalls.length).toBeGreaterThanOrEqual(2);

      const startingCall = emitCalls[0]!;
      expect(startingCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Starting',
            runtimeId: 'instance-1',
          }),
        }),
      );

      const failedCall = emitCalls[emitCalls.length - 1]!;
      expect(failedCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Failed',
            runtimeId: 'instance-1',
            message: 'Sandbox creation timed out after 300s',
          }),
        }),
      );
    });

    it('emits notifications for existing record re-start path', async () => {
      const existingRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.getOne.mockResolvedValue(existingRecord);
      mockDao.updateById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockResolvedValue(mockSandbox);

      await provider.provide(baseParams);

      const emitCalls = mockNotificationsService.emit.mock.calls;
      expect(emitCalls).toHaveLength(2);

      const startingCall = emitCalls[0]!;
      expect(startingCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Starting',
            runtimeId: 'instance-1',
          }),
        }),
      );

      const runningCall = emitCalls[1]!;
      expect(runningCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({
            status: 'Running',
            runtimeId: 'instance-1',
          }),
        }),
      );
    });

    it('does not propagate notification emit failures', async () => {
      mockDao.getOne.mockResolvedValue(null);
      const createdRecord = buildRecord({
        status: RuntimeInstanceStatus.Starting,
      });
      mockDao.create.mockResolvedValue(createdRecord);
      mockDao.updateById.mockResolvedValue(undefined);

      mockDaytonaInstance.findOne.mockRejectedValue(new Error('Not found'));
      mockDaytonaInstance.create.mockResolvedValue(mockSandbox);

      // Make emit reject — should not affect provide()
      mockNotificationsService.emit.mockRejectedValue(
        new Error('WebSocket failure'),
      );

      const result = await provider.provide(baseParams);

      expect(result.cached).toBe(false);
      expect(result.runtime).toBeDefined();
    });
  });
});
