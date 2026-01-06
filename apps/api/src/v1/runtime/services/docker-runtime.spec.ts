import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DockerRuntime } from './docker-runtime';

const mockResult = {
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  fail: false,
  execPath: '/runtime-workspace',
};

describe('DockerRuntime (sessions)', () => {
  let runtime: DockerRuntime;
  let runtimeSessionApi: {
    execInSession: DockerRuntime['execInSession'];
    enqueueSessionCommand: DockerRuntime['enqueueSessionCommand'];
    ensureSession: DockerRuntime['ensureSession'];
  };

  beforeEach(() => {
    runtime = new DockerRuntime({} as never);
    // Bypass the runtime-not-started guard; we stub execInSession, so no real container is needed.
    (runtime as unknown as { container: Record<string, unknown> }).container =
      {};
    runtimeSessionApi = runtime as unknown as typeof runtimeSessionApi;
  });

  it('routes sessionId exec calls through execInSession', async () => {
    const execInSession = vi
      .spyOn(runtimeSessionApi, 'execInSession')
      .mockResolvedValue(mockResult);

    const result = await runtime.exec({ cmd: 'echo 1', sessionId: 'sess-1' });

    expect(execInSession).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: 'echo 1', sessionId: 'sess-1' }),
      '/runtime-workspace',
      undefined,
    );
    expect(result).toEqual(mockResult);
  });

  it('builds env-prefixed script for session execution', async () => {
    const enqueueSpy = vi
      .spyOn(runtimeSessionApi, 'enqueueSessionCommand')
      .mockImplementation((_session: unknown, command: any) => {
        command.resolve(mockResult);
      });

    vi.spyOn(runtimeSessionApi, 'ensureSession').mockResolvedValue({
      id: 'sess-env',
      workdir: '/runtime-workspace',
      exec: {} as never,
      inputStream: { write: vi.fn() } as never,
      stdoutStream: new PassThrough(),
      stderrStream: new PassThrough(),
      stdoutBuffer: '',
      stderrBuffer: '',
      queue: [],
      busy: false,
    });

    const result = await runtimeSessionApi.execInSession(
      { cmd: 'echo $FOO', sessionId: 'sess-env', env: { FOO: 'bar' } },
      '/runtime-workspace',
      ['FOO=bar'],
    );

    const [, commandArg] = enqueueSpy.mock.calls[0]!;
    expect(commandArg.script).toContain("FOO='bar'");
    expect(commandArg.script).toContain('echo $FOO');
    expect(result).toEqual(mockResult);
  });

  it('prepends cd command when cwd is provided in session execution', async () => {
    const enqueueSpy = vi
      .spyOn(runtimeSessionApi, 'enqueueSessionCommand')
      .mockImplementation((_session: unknown, command: any) => {
        command.resolve(mockResult);
      });

    vi.spyOn(runtimeSessionApi, 'ensureSession').mockResolvedValue({
      id: 'sess-cwd',
      workdir: '/runtime-workspace',
      exec: {} as never,
      inputStream: { write: vi.fn() } as never,
      stdoutStream: new PassThrough(),
      stderrStream: new PassThrough(),
      stdoutBuffer: '',
      stderrBuffer: '',
      queue: [],
      busy: false,
    });

    const result = await runtimeSessionApi.execInSession(
      { cmd: 'ls', sessionId: 'sess-cwd', cwd: '/app/src' },
      '/runtime-workspace',
    );

    const [, commandArg] = enqueueSpy.mock.calls[0]!;
    expect(commandArg.script).toContain('cd "/app/src"');
    expect(commandArg.script).toContain('ls');
    expect(result).toEqual(mockResult);
  });

  it('handles cwd with spaces and special characters in session execution', async () => {
    const enqueueSpy = vi
      .spyOn(runtimeSessionApi, 'enqueueSessionCommand')
      .mockImplementation((_session: unknown, command: any) => {
        command.resolve(mockResult);
      });

    vi.spyOn(runtimeSessionApi, 'ensureSession').mockResolvedValue({
      id: 'sess-cwd-special',
      workdir: '/runtime-workspace',
      exec: {} as never,
      inputStream: { write: vi.fn() } as never,
      stdoutStream: new PassThrough(),
      stderrStream: new PassThrough(),
      stdoutBuffer: '',
      stderrBuffer: '',
      queue: [],
      busy: false,
    });

    const result = await runtimeSessionApi.execInSession(
      { cmd: 'pwd', sessionId: 'sess-cwd-special', cwd: '/path with spaces' },
      '/runtime-workspace',
    );

    const [, commandArg] = enqueueSpy.mock.calls[0]!;
    expect(commandArg.script).toContain('cd "/path with spaces"');
    expect(result).toEqual(mockResult);
  });
});
