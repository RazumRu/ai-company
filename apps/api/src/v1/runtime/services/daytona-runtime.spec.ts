import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    deleteSession: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
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
    it('routes through executeCommand on sandbox', async () => {
      mockSandbox.process.executeCommand.mockResolvedValue({
        exitCode: 0,
        result: 'hello',
      });

      const result = await runtime.exec({ cmd: 'echo hello' });

      expect(mockSandbox.process.executeCommand).toHaveBeenCalledWith(
        'echo hello',
        undefined,
        undefined,
        undefined,
      );
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });

    it('prepends cd command when cwd is provided', async () => {
      mockSandbox.process.executeCommand.mockResolvedValue({
        exitCode: 0,
        result: '/app/src',
      });

      const result = await runtime.exec({
        cmd: 'pwd',
        cwd: '/app/src',
      });

      expect(mockSandbox.process.executeCommand).toHaveBeenCalledWith(
        expect.stringContaining('cd "/app/src"'),
        undefined,
        undefined,
        undefined,
      );
      expect(result.fail).toBe(false);
    });

    it('passes env to non-session executeCommand', async () => {
      mockSandbox.process.executeCommand.mockResolvedValue({
        exitCode: 0,
        result: 'ok',
      });

      const result = await runtime.exec({
        cmd: 'echo $FOO',
        env: { FOO: 'bar' },
      });

      expect(mockSandbox.process.executeCommand).toHaveBeenCalledWith(
        'echo $FOO',
        undefined,
        { FOO: 'bar' },
        undefined,
      );
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('session-based exec()', () => {
    it('creates session on first call and routes through executeSessionCommand', async () => {
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        exitCode: 0,
        output: 'session output',
        stdout: 'session stdout',
        stderr: '',
      });

      const result = await runtime.exec({
        cmd: 'echo test',
        sessionId: 'sess-1',
      });

      expect(mockSandbox.process.createSession).toHaveBeenCalledWith('sess-1');
      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          command: expect.stringContaining('echo test'),
        }),
        undefined,
      );
      expect(result.fail).toBe(false);
      expect(result.stdout).toBe('session stdout');
    });

    it('does not recreate session on subsequent calls', async () => {
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      });

      await runtime.exec({ cmd: 'echo 1', sessionId: 'sess-reuse' });
      await runtime.exec({ cmd: 'echo 2', sessionId: 'sess-reuse' });

      expect(mockSandbox.process.createSession).toHaveBeenCalledTimes(1);
      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledTimes(
        2,
      );
    });

    it('prepends cd command for cwd in session execution', async () => {
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      await runtime.exec({
        cmd: 'ls',
        sessionId: 'sess-cwd',
        cwd: '/workspace',
      });

      expect(mockSandbox.process.executeSessionCommand).toHaveBeenCalledWith(
        'sess-cwd',
        expect.objectContaining({
          command: expect.stringContaining('cd "/workspace"'),
        }),
        undefined,
      );
    });
  });

  describe('execStream()', () => {
    it('throws descriptive error', async () => {
      await expect(runtime.execStream(['ls'])).rejects.toThrow(
        'execStream is not supported by DaytonaRuntime',
      );
    });
  });

  describe('stop()', () => {
    it('cleans up sandbox and sessions', async () => {
      // Add a session
      mockSandbox.process.createSession.mockResolvedValue(undefined);
      mockSandbox.process.executeSessionCommand.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });
      await runtime.exec({ cmd: 'echo 1', sessionId: 'sess-cleanup' });

      // Set up daytona mock for delete
      const mockDaytona = { delete: vi.fn().mockResolvedValue(undefined) };
      (runtime as unknown as { daytona: typeof mockDaytona }).daytona =
        mockDaytona;

      await runtime.stop();

      expect(mockSandbox.process.deleteSession).toHaveBeenCalledWith(
        'sess-cleanup',
      );
      expect(mockDaytona.delete).toHaveBeenCalledWith(mockSandbox);
    });
  });

  describe('abort signal handling', () => {
    it('returns aborted result when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await runtime.exec({
        cmd: 'sleep 60',
        signal: abortController.signal,
      });

      expect(result.fail).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toBe('Aborted');
    });

    it('returns aborted result when signal fires during execution', async () => {
      const abortController = new AbortController();

      // Make executeCommand hang until abort
      mockSandbox.process.executeCommand.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ exitCode: 0, result: 'done' }), 5000);
          }),
      );

      const execPromise = runtime.exec({
        cmd: 'sleep 60',
        signal: abortController.signal,
      });

      // Abort after short delay
      setTimeout(() => abortController.abort(), 50);

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
          data: expect.objectContaining({ status: 'Starting', runtimeId: 'instance-1' }),
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
          data: expect.objectContaining({ status: 'Starting', runtimeId: 'instance-1' }),
        }),
      );

      const runningCall = emitCalls[1]!;
      expect(runningCall[0]).toEqual(
        expect.objectContaining({
          type: NotificationEvent.RuntimeStatus,
          data: expect.objectContaining({ status: 'Running', runtimeId: 'instance-1' }),
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
