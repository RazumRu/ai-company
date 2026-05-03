/**
 * Standalone integration test script for DaytonaRuntime refactor.
 *
 * Skipped by default. Opt in with `RUN_REAL_DAYTONA_TESTS=1` plus
 * `DAYTONA_API_KEY` / `DAYTONA_API_URL` set to a reachable Daytona instance.
 * Tests exec, timeout, abort, recovery, and PTY execStream.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { DaytonaRuntime } from '../../v1/runtime/services/daytona-runtime';
import { describeIfRealDaytona as describe } from '../integration/helpers/real-runtime-gate';

const API_KEY = process.env.DAYTONA_API_KEY ?? '';
const API_URL = process.env.DAYTONA_API_URL ?? '';
const IMAGE =
  process.env.DAYTONA_SANDBOX_IMAGE ?? 'razumru/geniro-runtime:latest';

describe('DaytonaRuntime Refactor — Live Verification', () => {
  let runtime: DaytonaRuntime;

  beforeAll(async () => {
    runtime = new DaytonaRuntime(
      { apiKey: API_KEY, apiUrl: API_URL },
      { snapshot: IMAGE },
    );

    await runtime.start({
      containerName: `test-refactor-${Date.now()}`,
      image: IMAGE,
      recreate: true,
    });

    // Verify bash is available — Daytona PTY hardcodes /usr/bin/bash.
    const bashCheck = await runtime.exec({ cmd: 'which bash' });
    if (bashCheck.fail) {
      throw new Error(
        'bash not found in sandbox image — PTY tests require /usr/bin/bash. ' +
          'Use an image that includes bash or set DAYTONA_SANDBOX_IMAGE.',
      );
    }
  }, 120_000);

  afterAll(async () => {
    await runtime?.stop().catch(() => undefined);
  }, 30_000);

  // 1. Fast command
  it('fast command — echo completes quickly', async () => {
    const start = Date.now();
    const result = await runtime.exec({ cmd: 'echo "fast-test"' });
    const elapsed = Date.now() - start;

    expect(result.fail).toBe(false);
    expect(result.stdout).toContain('fast-test');
    expect(elapsed).toBeLessThan(4000);
  }, 10_000);

  // 1b. Nonexistent command — must fail fast (no 5-min hang)
  it('nonexistent command — fails fast with non-zero exit code', async () => {
    const start = Date.now();
    const result = await runtime.exec({ cmd: 'nonexistent_command_xyz' });
    const elapsed = Date.now() - start;

    expect(result.exitCode).not.toBe(0);
    expect(result.fail).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);

  // 2. Long command
  it('long command — sleep 2 then echo', async () => {
    const result = await runtime.exec({ cmd: 'sleep 2 && echo "done"' });

    expect(result.fail).toBe(false);
    expect(result.stdout).toContain('done');
  }, 15_000);

  // 3. Hard timeout
  it('hard timeout — sleep 120 with timeoutMs: 2000', async () => {
    const result = await runtime.exec({
      cmd: 'sleep 120',
      timeoutMs: 2000,
    });

    expect(result.fail).toBe(true);
    expect(result.exitCode).toBe(124);
  }, 15_000);

  // 4. Idle timeout — requires sessionId to activate the streaming path
  // (runAsync: true + awaitCommand), which is the only path that tracks
  // output activity for idle timeout detection.
  it('idle timeout — sleep 120 with idleTimeoutMs: 2000', async () => {
    const result = await runtime.exec({
      cmd: 'sleep 120',
      sessionId: `test-idle-${Date.now()}`,
      idleTimeoutMs: 2000,
    });

    expect(result.fail).toBe(true);
    expect(result.exitCode).toBe(124);
  }, 15_000);

  // 5. Session recovery
  it('session recovery — timeout then run another command on same session', async () => {
    const sessionId = `test-session-${Date.now()}`;

    // First command: timeout
    const timeoutResult = await runtime.exec({
      cmd: 'sleep 120',
      sessionId,
      timeoutMs: 2000,
    });
    expect(timeoutResult.exitCode).toBe(124);

    // Second command: should succeed after session recovery
    const recoveryResult = await runtime.exec({
      cmd: 'echo "recovered"',
      sessionId,
    });
    expect(recoveryResult.fail).toBe(false);
    expect(recoveryResult.stdout).toContain('recovered');
  }, 30_000);

  // 6. Abort signal
  it('abort signal — cancel after 300ms', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);

    const result = await runtime.exec({
      cmd: 'sleep 120',
      signal: controller.signal,
    });

    expect(result.fail).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toBe('Aborted');
  }, 10_000);

  // 7. PTY execStream
  // Note: Daytona PTY requires /usr/bin/bash inside the sandbox.
  // bash is verified in beforeAll — no conditional skip.
  it('PTY execStream — echo output', async () => {
    const { stdin, stdout, close } = await runtime.execStream([
      'echo',
      'pty-output',
    ]);

    const chunks: string[] = [];
    stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    // Wait for the echo output to arrive, then exit the PTY shell
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        close();
        reject(new Error('execStream timed out after 15s'));
      }, 15_000);

      const check = setInterval(() => {
        const fullOutput = chunks.join('');
        if (fullOutput.includes('pty-output')) {
          clearInterval(check);
          clearTimeout(timeout);
          // Send exit to cleanly close the PTY shell
          stdin.write('exit\n');
          resolve();
        }
      }, 200);

      stdout.on('end', () => {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      });
    });

    const fullOutput = chunks.join('');
    expect(fullOutput).toContain('pty-output');
    close();
  }, 60_000);
});
