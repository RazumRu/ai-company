import { afterAll, beforeAll, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { DaytonaRuntime } from '../../../v1/runtime/services/daytona-runtime';
import { describeIfRealDaytona as describe } from '../helpers/real-runtime-gate';

/**
 * Integration tests for DaytonaRuntime against a real Daytona API.
 *
 * Skipped by default — opt in with `RUN_REAL_DAYTONA_TESTS=1` plus
 * `DAYTONA_API_KEY` / `DAYTONA_API_URL` set to point at a reachable Daytona
 * instance. The default integration suite has no Daytona service available,
 * and the dev defaults baked into `environment.dev.ts` point at a local URL
 * that doesn't actually exist.
 */
const SANDBOX_IMAGE = 'daytonaio/sandbox:0.5.0-slim';

let sandboxCreationElapsedMs: number;

describe('DaytonaRuntime Timeout Recovery Integration', () => {
  let runtime: DaytonaRuntime;

  beforeAll(async () => {
    const apiKey = environment.daytonaApiKey;
    const apiUrl = environment.daytonaApiUrl;

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

    const startTime = Date.now();
    await runtime.start({
      containerName: `test-daytona-recovery-${Date.now()}`,
      image: SANDBOX_IMAGE,
      recreate: true,
    });
    sandboxCreationElapsedMs = Date.now() - startTime;
  }, 300_000);

  it('sandbox creation completes within 300s', { timeout: 5_000 }, () => {
    expect(sandboxCreationElapsedMs).toBeLessThan(300_000);
  });

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

  it(
    'exec returns correct exit code and stdout',
    { timeout: 30_000 },
    async () => {
      const result = await runtime.exec({ cmd: 'echo "hello-daytona"' });
      expect(result.fail).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello-daytona');
    },
  );

  it(
    'exec returns non-zero exit code on failure',
    { timeout: 30_000 },
    async () => {
      const result = await runtime.exec({
        cmd: 'bash -c "exit 42"',
        timeoutMs: 15_000,
      });
      expect(result.exitCode).toBe(42);
      expect(result.fail).toBe(true);
    },
  );

  it(
    'creates and reads a file in the sandbox',
    { timeout: 30_000 },
    async () => {
      const writeResult = await runtime.exec({
        cmd: 'echo "hello from daytona" > /tmp/int-test.txt',
      });
      expect(writeResult.fail).toBe(false);
      expect(writeResult.exitCode).toBe(0);

      const readResult = await runtime.exec({ cmd: 'cat /tmp/int-test.txt' });
      expect(readResult.fail).toBe(false);
      expect(readResult.stdout).toContain('hello from daytona');
    },
  );

  it('edits an existing file in the sandbox', { timeout: 30_000 }, async () => {
    await runtime.exec({ cmd: 'echo "original" > /tmp/edit-test.txt' });

    const editResult = await runtime.exec({
      cmd: 'sed -i "s/original/edited/" /tmp/edit-test.txt',
    });
    expect(editResult.fail).toBe(false);
    expect(editResult.exitCode).toBe(0);

    const verifyResult = await runtime.exec({ cmd: 'cat /tmp/edit-test.txt' });
    expect(verifyResult.stdout).toContain('edited');
    expect(verifyResult.stdout).not.toContain('original');
  });
});
