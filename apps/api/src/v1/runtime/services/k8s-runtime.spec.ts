import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPodName } from './k8s-runtime.utils';

// ---------------------------------------------------------------------------
// Mock @kubernetes/client-node
// The mock shape differs from DaytonaRuntime's because CoreV1Api is obtained via
// kc.makeApiClient(CoreV1Api) rather than new CoreV1Api() directly.
// ---------------------------------------------------------------------------

const mockCoreApi = {
  createNamespacedPod: vi.fn(),
  readNamespacedPod: vi.fn(),
  deleteNamespacedPod: vi.fn(),
  listNamespacedPod: vi.fn(),
  patchNamespacedPod: vi.fn(),
};

const mockExec = { exec: vi.fn() };
const mockWatch = { watch: vi.fn() };

vi.mock('@kubernetes/client-node', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@kubernetes/client-node')>();
  return {
    ...actual,
    KubeConfig: vi.fn(function (this: unknown) {
      Object.assign(this as object, {
        loadFromDefault: vi.fn(),
        loadFromCluster: vi.fn(),
        makeApiClient: vi.fn(() => mockCoreApi),
      });
    }),
    CoreV1Api: vi.fn(), // identity token used by makeApiClient
    Exec: vi.fn(function (this: unknown) {
      Object.assign(this as object, mockExec);
    }),
    Watch: vi.fn(function (this: unknown) {
      Object.assign(this as object, mockWatch);
    }),
  };
});

// Import after mock registration
import { K8sRuntime } from './k8s-runtime';
import type { K8sRuntimeConfig } from './k8s-runtime.types';

// ---------------------------------------------------------------------------
// Shared test config
// ---------------------------------------------------------------------------

const TEST_CONFIG: K8sRuntimeConfig = {
  namespace: 'geniro-test',
  image: 'geniro/runtime:latest',
  runtimeClass: 'gvisor',
  serviceAccount: 'geniro-runtime',
  cpuRequest: '100m',
  cpuLimit: '1',
  memoryRequest: '128Mi',
  memoryLimit: '512Mi',
  readyTimeoutMs: 5_000,
  inCluster: false,
};

/** Returns a pod-status body with the given phase and optional Ready condition. */
function makePodStatus(phase: string, ready = true) {
  return {
    metadata: {
      name: 'geniro-sb-abc',
      labels: {
        'geniro.io/thread-id': 'thread-1',
        'geniro.io/node-id': 'node-1',
        'geniro.io/graph-id': 'graph-1',
      },
    },
    status: {
      phase,
      conditions: ready ? [{ type: 'Ready', status: 'True' }] : [],
    },
  };
}

/** Stubs the exec mock to call the statusCallback immediately. */
function stubExecSuccess(exitCode = 0) {
  mockExec.exec.mockImplementation(
    async (
      _ns: string,
      _pod: string,
      _container: string,
      _cmd: string[],
      _stdout: PassThrough,
      _stderr: PassThrough,
      _stdin: unknown,
      _tty: boolean,
      statusCb: (s: unknown) => void,
    ) => {
      statusCb({
        status: exitCode === 0 ? 'Success' : 'Failure',
        details:
          exitCode !== 0
            ? { causes: [{ reason: 'ExitCode', message: String(exitCode) }] }
            : undefined,
      });
      return { close: vi.fn() };
    },
  );
}

/** Stubs the exec mock to write to stdout/stderr before calling statusCb. */
function stubExecWithOutput(stdout: string, stderr: string, exitCode = 0) {
  mockExec.exec.mockImplementation(
    async (
      _ns: string,
      _pod: string,
      _container: string,
      _cmd: string[],
      stdoutStream: PassThrough,
      stderrStream: PassThrough,
      _stdin: unknown,
      _tty: boolean,
      statusCb: (s: unknown) => void,
    ) => {
      stdoutStream.write(stdout);
      stderrStream.write(stderr);
      statusCb({
        status: exitCode === 0 ? 'Success' : 'Failure',
        details:
          exitCode !== 0
            ? { causes: [{ reason: 'ExitCode', message: String(exitCode) }] }
            : undefined,
      });
      return { close: vi.fn() };
    },
  );
}

/**
 * Injects both podName and coreApi into a K8sRuntime instance so tests can
 * exercise instance methods without calling start().
 */
function injectPodState(rt: K8sRuntime, podName = 'geniro-sb-testpod') {
  (rt as unknown as { podName: string }).podName = podName;
  (rt as unknown as { coreApi: typeof mockCoreApi }).coreApi = mockCoreApi;
  // kubeConfig must be non-null to satisfy the exec() guard
  (rt as unknown as { kubeConfig: unknown }).kubeConfig = {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('K8sRuntime', () => {
  let runtime: K8sRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new K8sRuntime(TEST_CONFIG);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // start()
  // -------------------------------------------------------------------------

  describe('start()', () => {
    it('creates a pod and waits for Ready status', async () => {
      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );

      await runtime.start({
        labels: {
          'geniro.io/graph-id': 'graph-1',
          'geniro.io/node-id': 'node-1',
          'geniro.io/thread-id': 'thread-1',
        },
      });

      expect(mockCoreApi.createNamespacedPod).toHaveBeenCalledOnce();
      expect(mockCoreApi.readNamespacedPod).toHaveBeenCalled();
      expect(runtime.getPodName()).not.toBeNull();
    });

    it('times out waiting for Ready and deletes the pod, throwing InternalException', async () => {
      // Use a very short timeout
      const shortTimeoutRuntime = new K8sRuntime({
        ...TEST_CONFIG,
        readyTimeoutMs: 50,
      });

      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      // Pod never becomes Ready
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Pending', false),
      );
      mockCoreApi.deleteNamespacedPod.mockResolvedValue({});

      await expect(
        shortTimeoutRuntime.start({
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).rejects.toMatchObject({ name: 'InternalException' });

      // Pod should have been deleted on timeout
      expect(mockCoreApi.deleteNamespacedPod).toHaveBeenCalled();
      // podName is cleared after timeout
      expect(shortTimeoutRuntime.getPodName()).toBeNull();
    });

    it('adopts an existing pod on 409 Conflict when labels match', async () => {
      const conflict409 = Object.assign(new Error('Conflict'), { code: 409 });

      mockCoreApi.createNamespacedPod.mockRejectedValueOnce(conflict409);
      // readNamespacedPod returns pod with matching labels
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );
      // readNamespacedPod for ready-wait
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );

      await expect(
        runtime.start({
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).resolves.not.toThrow();

      // Should NOT have tried to delete since labels matched
      expect(mockCoreApi.deleteNamespacedPod).not.toHaveBeenCalled();
    });

    // K-14a: warm-pool claim path — successful claim short-circuits createNamespacedPod
    it('uses warm pod when claimWarmPod returns a name (K-14a)', async () => {
      const warmPool = {
        claimWarmPod: vi.fn().mockResolvedValue('wp-claimed-pod'),
      };
      const rtWithPool = new K8sRuntime(TEST_CONFIG, { warmPool });

      // Warm pod is immediately ready
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );

      await rtWithPool.start({
        labels: {
          'geniro.io/graph-id': 'graph-1',
          'geniro.io/node-id': 'node-1',
          'geniro.io/thread-id': 'thread-1',
        },
      });

      // Pod was claimed — normal creation should NOT have been called
      expect(mockCoreApi.createNamespacedPod).not.toHaveBeenCalled();
      // The runtime's pod name is the claimed pod name
      expect(rtWithPool.getPodName()).toBe('wp-claimed-pod');
    });

    // K-14b: warm-pool claim path — null claim falls through to normal creation
    it('falls through to normal pod creation when claimWarmPod returns null (K-14b)', async () => {
      const warmPool = {
        claimWarmPod: vi.fn().mockResolvedValue(null),
      };
      const rtWithPool = new K8sRuntime(TEST_CONFIG, { warmPool });

      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );

      await rtWithPool.start({
        labels: {
          'geniro.io/graph-id': 'graph-1',
          'geniro.io/node-id': 'node-1',
          'geniro.io/thread-id': 'thread-1',
        },
      });

      // Fell through — normal creation was called
      expect(mockCoreApi.createNamespacedPod).toHaveBeenCalledOnce();
    });

    // K-19: waitForPodReady Failed/Succeeded phase
    it('rejects and deletes pod when pod enters Failed phase (K-19)', async () => {
      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      // Pod immediately goes to Failed phase
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Failed', false),
      );
      mockCoreApi.deleteNamespacedPod.mockResolvedValue({});

      await expect(
        runtime.start({
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).rejects.toMatchObject({ name: 'InternalException' });

      expect(mockCoreApi.deleteNamespacedPod).toHaveBeenCalled();
    });

    // K-17: initScript path
    it('runs initScript when provided and resolves on exit 0 (K-17a)', async () => {
      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );
      stubExecSuccess(0);

      await expect(
        runtime.start({
          initScript: 'echo init',
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).resolves.not.toThrow();

      expect(mockExec.exec).toHaveBeenCalled();
    });

    it('rejects with InternalException when initScript exits non-zero (K-17b)', async () => {
      mockCoreApi.createNamespacedPod.mockResolvedValue({});
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );
      stubExecSuccess(1);

      await expect(
        runtime.start({
          initScript: 'bad-command',
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).rejects.toMatchObject({ name: 'InternalException' });
    });

    it('deletes and retries when 409 pod has mismatched labels', async () => {
      const conflict409 = Object.assign(new Error('Conflict'), { code: 409 });

      mockCoreApi.createNamespacedPod
        .mockRejectedValueOnce(conflict409)
        .mockResolvedValueOnce({});

      // First readNamespacedPod returns pod with DIFFERENT labels (label
      // check on 409 conflict). Subsequent calls return the ready pod
      // (waitForPodReady polling after retry succeeds).
      mockCoreApi.readNamespacedPod.mockResolvedValueOnce({
        metadata: {
          labels: {
            'geniro.io/thread-id': 'other-thread',
            'geniro.io/node-id': 'other-node',
            'geniro.io/graph-id': 'other-graph',
          },
        },
      });
      mockCoreApi.deleteNamespacedPod.mockResolvedValue({});
      mockCoreApi.readNamespacedPod.mockResolvedValue(
        makePodStatus('Running', true),
      );

      await expect(
        runtime.start({
          labels: {
            'geniro.io/graph-id': 'graph-1',
            'geniro.io/node-id': 'node-1',
            'geniro.io/thread-id': 'thread-1',
          },
        }),
      ).resolves.not.toThrow();

      // Delete was called for the conflicting pod
      expect(mockCoreApi.deleteNamespacedPod).toHaveBeenCalledOnce();
      // createNamespacedPod was called twice (first attempt + retry)
      expect(mockCoreApi.createNamespacedPod).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('deletes the pod by name', async () => {
      injectPodState(runtime);
      mockCoreApi.deleteNamespacedPod.mockResolvedValue({});

      await runtime.stop();

      expect(mockCoreApi.deleteNamespacedPod).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'geniro-sb-testpod',
          namespace: TEST_CONFIG.namespace,
          gracePeriodSeconds: 0,
        }),
      );
      expect(runtime.getPodName()).toBeNull();
    });

    it('swallows 404 errors silently when pod is already gone', async () => {
      injectPodState(runtime);

      const notFound = Object.assign(new Error('Not Found'), { code: 404 });
      mockCoreApi.deleteNamespacedPod.mockRejectedValue(notFound);

      await expect(runtime.stop()).resolves.not.toThrow();
      expect(runtime.getPodName()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // exec()
  // -------------------------------------------------------------------------

  describe('exec()', () => {
    beforeEach(() => {
      injectPodState(runtime);
    });

    it('returns exit code from V1Status', async () => {
      stubExecSuccess(0);

      const result = await runtime.exec({ cmd: 'echo hello' });

      expect(result.exitCode).toBe(0);
      expect(result.fail).toBe(false);
    });

    it('captures stdout and stderr separately', async () => {
      stubExecWithOutput('hello stdout', 'hello stderr', 0);

      const result = await runtime.exec({ cmd: 'echo hello' });

      expect(result.stdout).toContain('hello stdout');
      expect(result.stderr).toContain('hello stderr');
    });

    it('returns exit code 1 when command fails', async () => {
      stubExecSuccess(1);

      const result = await runtime.exec({ cmd: 'false' });

      expect(result.exitCode).toBe(1);
      expect(result.fail).toBe(true);
    });

    it('honors AbortSignal and returns exitCode 124', async () => {
      // exec mock never calls statusCb (simulates hanging command)
      mockExec.exec.mockImplementation(async () => {
        return { close: vi.fn() };
      });

      const controller = new AbortController();
      const execPromise = runtime.exec({
        cmd: 'sleep 100',
        signal: controller.signal,
      });

      // Abort immediately
      controller.abort();

      const result = await execPromise;
      expect(result.exitCode).toBe(124);
    });

    it('returns exitCode 124 when already-aborted signal is passed', async () => {
      const controller = new AbortController();
      controller.abort();

      // exec should NOT be called at all — resolves with 124 immediately
      mockExec.exec.mockImplementation(async () => ({ close: vi.fn() }));

      const result = await runtime.exec({
        cmd: 'echo hello',
        signal: controller.signal,
      });

      expect(result.exitCode).toBe(124);
    });

    // K-16: timeoutMs path — exec stub never calls statusCb
    it('returns exitCode 124 when timeoutMs elapses before exec completes (K-16)', async () => {
      vi.useFakeTimers();

      // exec mock never invokes statusCb — simulates a hanging command
      mockExec.exec.mockImplementation(async () => ({ close: vi.fn() }));

      const execPromise = runtime.exec({
        cmd: 'sleep 100',
        timeoutMs: 50,
      });

      // Advance fake timers past the timeout
      await vi.advanceTimersByTimeAsync(100);

      const result = await execPromise;
      expect(result.exitCode).toBe(124);

      vi.useRealTimers();
    });

    it('returns exitCode 124 when tailTimeoutMs elapses after initial output goes silent', async () => {
      vi.useFakeTimers();

      // exec mock writes one chunk to arm the tail timer, then stays silent.
      mockExec.exec.mockImplementation(
        async (
          _ns: string,
          _pod: string,
          _container: string,
          _cmd: string[],
          stdoutStream: PassThrough,
          _stderrStream: PassThrough,
          _stdin: unknown,
          _tty: boolean,
          _statusCb: (s: unknown) => void,
        ) => {
          stdoutStream.write(Buffer.from('start\n'));
          return { close: vi.fn() };
        },
      );

      const execPromise = runtime.exec({
        cmd: 'echo start; sleep 100',
        tailTimeoutMs: 50,
        timeoutMs: 10_000,
      });

      // Let the stream write flush
      await vi.advanceTimersByTimeAsync(1);
      // Advance past tailTimeoutMs — no new data, tail should fire
      await vi.advanceTimersByTimeAsync(100);

      const result = await execPromise;
      expect(result.exitCode).toBe(124);
      expect(result.stdout).toContain('start');

      vi.useRealTimers();
    });

    it('does not fire tailTimeoutMs when output keeps flowing', async () => {
      vi.useFakeTimers();

      let intervalId: NodeJS.Timeout | null = null;

      mockExec.exec.mockImplementation(
        async (
          _ns: string,
          _pod: string,
          _container: string,
          _cmd: string[],
          stdoutStream: PassThrough,
          _stderrStream: PassThrough,
          _stdin: unknown,
          _tty: boolean,
          statusCb: (s: unknown) => void,
        ) => {
          // Emit a chunk every 20ms so the tail timer resets continuously
          intervalId = setInterval(() => stdoutStream.write('tick\n'), 20);
          // Resolve successfully after 200ms
          setTimeout(() => {
            if (intervalId !== null) {
              clearInterval(intervalId);
            }
            statusCb({ status: 'Success' });
          }, 200);
          return { close: vi.fn() };
        },
      );

      const execPromise = runtime.exec({
        cmd: 'yes',
        tailTimeoutMs: 50,
        timeoutMs: 10_000,
      });

      await vi.advanceTimersByTimeAsync(250);

      const result = await execPromise;
      expect(result.exitCode).toBe(0);

      vi.useRealTimers();
    });

    // K-18: 4 MiB output cap
    it('caps stdout at 4 MiB and retains tail content (K-18)', async () => {
      const FOUR_MIB = 4 * 1024 * 1024;
      const FIVE_MIB = 5 * 1024 * 1024;

      const tailMarker = 'TAIL_MARKER';
      // Build a 5 MiB payload: 5MiB - marker bytes of 'x', then the marker
      const filler = Buffer.alloc(FIVE_MIB - tailMarker.length, 'x');
      const bigPayload = Buffer.concat([filler, Buffer.from(tailMarker)]);

      mockExec.exec.mockImplementation(
        async (
          _ns: string,
          _pod: string,
          _container: string,
          _cmd: string[],
          stdoutStream: PassThrough,
          _stderrStream: PassThrough,
          _stdin: unknown,
          _tty: boolean,
          statusCb: (s: unknown) => void,
        ) => {
          stdoutStream.write(bigPayload);
          statusCb({ status: 'Success' });
          return { close: vi.fn() };
        },
      );

      const result = await runtime.exec({ cmd: 'cat big-file' });

      expect(result.stdout.length).toBeLessThanOrEqual(FOUR_MIB);
      expect(result.stdout).toContain(tailMarker);
    });

    it('throws when runtime is not started', async () => {
      const notStarted = new K8sRuntime(TEST_CONFIG);

      await expect(notStarted.exec({ cmd: 'ls' })).rejects.toMatchObject({
        name: 'InternalException',
      });
    });
  });

  // -------------------------------------------------------------------------
  // execStream()
  // -------------------------------------------------------------------------

  describe('execStream()', () => {
    beforeEach(() => {
      injectPodState(runtime);
    });

    it('returns streams that emit data from the mock exec callbacks', async () => {
      mockExec.exec.mockImplementation(
        async (
          _ns: string,
          _pod: string,
          _container: string,
          _cmd: string[],
          stdoutStream: PassThrough,
          stderrStream: PassThrough,
        ) => {
          // Write data synchronously before returning
          stdoutStream.write('stream-stdout');
          stderrStream.write('stream-stderr');
          return { close: vi.fn() };
        },
      );

      const { stdout, stderr, close } = await runtime.execStream([
        'cat',
        '/etc/hostname',
      ]);

      // Collect all buffered data (streams are in paused mode until read)
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      // Use a promise to read data that may already be buffered
      const stdoutDone = new Promise<void>((resolve) => {
        stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
        stdout.on('end', resolve);
        stdout.on('close', resolve);
        // If data was written before we attached the listener and no 'end' fires,
        // read it from the buffer
        stdout.resume();
      });

      const stderrDone = new Promise<void>((resolve) => {
        stderr.on('data', (c: Buffer) => stderrChunks.push(c));
        stderr.on('end', resolve);
        stderr.on('close', resolve);
        stderr.resume();
      });

      // End the streams to trigger 'end' events
      stdout.end();
      stderr.end();

      await Promise.all([stdoutDone, stderrDone]);

      expect(Buffer.concat(stdoutChunks).toString()).toContain('stream-stdout');
      expect(Buffer.concat(stderrChunks).toString()).toContain('stream-stderr');

      close();
    });

    it('throws when runtime is not started', async () => {
      const notStarted = new K8sRuntime(TEST_CONFIG);

      await expect(notStarted.execStream(['ls'])).rejects.toMatchObject({
        name: 'InternalException',
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkHealth()
  // -------------------------------------------------------------------------

  describe('checkHealth()', () => {
    it('returns healthy: true when listNamespacedPod succeeds', async () => {
      mockCoreApi.listNamespacedPod.mockResolvedValue({
        items: [],
      });

      const result = await K8sRuntime.checkHealth(TEST_CONFIG);

      expect(result.healthy).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns healthy: false with error message on failure', async () => {
      mockCoreApi.listNamespacedPod.mockRejectedValue(
        new Error('connection refused'),
      );

      const result = await K8sRuntime.checkHealth(TEST_CONFIG);

      expect(result.healthy).toBe(false);
      expect(result.error).toContain('connection refused');
    });
  });

  // -------------------------------------------------------------------------
  // stopByName()
  // -------------------------------------------------------------------------

  describe('stopByName()', () => {
    it('deletes a pod by name using the request-object API', async () => {
      mockCoreApi.deleteNamespacedPod.mockResolvedValue({});

      await K8sRuntime.stopByName('geniro-sb-abc123', TEST_CONFIG);

      expect(mockCoreApi.deleteNamespacedPod).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'geniro-sb-abc123',
          namespace: TEST_CONFIG.namespace,
          gracePeriodSeconds: 0,
        }),
      );
    });

    it('swallows 404 when pod is already gone', async () => {
      const notFound = Object.assign(new Error('Not Found'), { code: 404 });
      mockCoreApi.deleteNamespacedPod.mockRejectedValue(notFound);

      await expect(
        K8sRuntime.stopByName('geniro-sb-missing', TEST_CONFIG),
      ).resolves.not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// buildPodName determinism — imported util, tested here per plan Step 6
// ---------------------------------------------------------------------------

describe('buildPodName (utility — determinism)', () => {
  it('produces the same name for the same inputs', () => {
    const a = buildPodName('graph-1', 'node-1', 'thread-1');
    const b = buildPodName('graph-1', 'node-1', 'thread-1');
    expect(a).toBe(b);
  });

  it('produces different names for different thread IDs', () => {
    const a = buildPodName('graph-1', 'node-1', 'thread-1');
    const b = buildPodName('graph-1', 'node-1', 'thread-2');
    expect(a).not.toBe(b);
  });

  it('starts with the geniro-sb- prefix', () => {
    const name = buildPodName('g', 'n', 't');
    expect(name).toMatch(/^geniro-sb-[0-9a-f]{12}$/);
  });

  it('handles null graphId', () => {
    const name = buildPodName(null, 'node-1', 'thread-1');
    expect(name).toMatch(/^geniro-sb-[0-9a-f]{12}$/);
  });
});
