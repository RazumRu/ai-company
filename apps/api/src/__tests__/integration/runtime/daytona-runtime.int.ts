import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { DaytonaRuntime } from '../../../v1/runtime/services/daytona-runtime';

/**
 * Integration tests for DaytonaRuntime.
 *
 * These tests require a running Daytona API instance and the following environment variables:
 *  - DAYTONA_API_KEY
 *  - DAYTONA_API_URL
 *
 * If not configured, the tests will fail with a clear error message
 * (no silent skipping per project policy).
 *
 * The test creates a sandbox from a Docker image (ubuntu:22.04) directly
 * rather than relying on a pre-pulled Daytona snapshot. This avoids
 * depending on the snapshot pull state which is asynchronous.
 */
const SANDBOX_IMAGE = 'daytonaio/sandbox:0.5.0-slim';

describe('DaytonaRuntime Timeout Recovery Integration', () => {
  let runtime: DaytonaRuntime;

  beforeAll(async () => {
    const apiKey = environment.daytonaApiKey;
    const apiUrl = environment.daytonaApiUrl;

    if (!apiKey || !apiUrl) {
      throw new Error(
        'DAYTONA_API_KEY and DAYTONA_API_URL must be set to run Daytona integration tests',
      );
    }

    runtime = new DaytonaRuntime(
      {
        apiKey,
        apiUrl,
        target: environment.daytonaTarget || undefined,
      },
      {
        snapshot: environment.dockerRuntimeImage || undefined,
      },
    );

    await runtime.start({
      containerName: `test-daytona-recovery-${Date.now()}`,
      image: SANDBOX_IMAGE,
      recreate: true,
    });
  }, 300_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop();
    }
  }, 30_000);

  it(
    'recovers after overall timeout and runs next command successfully',
    { timeout: 30_000 },
    async () => {
      const sessionId = 'sess-daytona-overall-timeout';

      const timeoutResult = await runtime.exec({
        cmd: 'sleep 60',
        sessionId,
        timeoutMs: 3000,
      });

      expect(timeoutResult.fail).toBe(true);

      // After timeout, the next command should still work
      const successResult = await runtime.exec({
        cmd: 'echo "recovery after timeout"',
        sessionId,
      });

      expect(successResult.fail).toBe(false);
      expect(successResult.exitCode).toBe(0);
      expect(successResult.stdout).toContain('recovery after timeout');
    },
  );

  it(
    'handles multiple sequential commands after timeout',
    { timeout: 30_000 },
    async () => {
      const sessionId = 'sess-daytona-multi-cmd';

      // First: trigger timeout
      await runtime.exec({
        cmd: 'sleep 60',
        sessionId,
        timeoutMs: 2000,
      });

      // Then: sequential commands should work
      const r1 = await runtime.exec({
        cmd: 'echo "cmd-1"',
        sessionId,
      });
      expect(r1.fail).toBe(false);
      expect(r1.stdout).toContain('cmd-1');

      const r2 = await runtime.exec({
        cmd: 'echo "cmd-2"',
        sessionId,
      });
      expect(r2.fail).toBe(false);
      expect(r2.stdout).toContain('cmd-2');
    },
  );

  it(
    'preserves filesystem state after recovery',
    { timeout: 30_000 },
    async () => {
      const sessionId = 'sess-daytona-fs-state';

      // Create a file
      const createResult = await runtime.exec({
        cmd: 'echo "daytona-test-content" > /tmp/daytona-test.txt',
        sessionId,
      });
      expect(createResult.fail).toBe(false);

      // Read it back
      const readResult = await runtime.exec({
        cmd: 'cat /tmp/daytona-test.txt',
        sessionId,
      });
      expect(readResult.fail).toBe(false);
      expect(readResult.stdout).toContain('daytona-test-content');
    },
  );

  it('handles abort signal', { timeout: 30_000 }, async () => {
    const sessionId = 'sess-daytona-abort';
    const controller = new AbortController();

    const execPromise = runtime.exec({
      cmd: 'sleep 60',
      sessionId,
      signal: controller.signal,
    });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 500);

    const result = await execPromise;

    expect(result.fail).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toBe('Aborted');

    // Verify next command still works
    const nextResult = await runtime.exec({
      cmd: 'echo "after abort"',
      sessionId,
    });
    expect(nextResult.fail).toBe(false);
    expect(nextResult.stdout).toContain('after abort');
  });

  it(
    'fast command completes without timeout firing',
    { timeout: 30_000 },
    async () => {
      const result = await runtime.exec({
        cmd: 'echo "fast"',
        timeoutMs: 10_000,
      });

      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('fast');
    },
  );
});
