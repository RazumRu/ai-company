import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { DockerRuntime } from './docker-runtime';

describe('DockerRuntime (integration)', () => {
  const runtime = new DockerRuntime({ socketPath: environment.dockerSocket });
  const image = 'alpine:3.19';

  beforeAll(async () => {
    // Start with minimal image and idle loop prepared by runtime
    await runtime.start({ image, env: { TEST_FLAG: '1' }, workdir: '/root' });
  }, 120_000);

  afterAll(async () => {
    await runtime.stop();
  }, 60_000);

  it('runs a simple echo command successfully', async () => {
    const res = await runtime.exec({
      cmd: 'echo "hello world"',
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('hello world');
    expect(res.stderr).toBe('');
  }, 60_000);

  it('runs a simple echo command with env successfully', async () => {
    const res = await runtime.exec({
      cmd: 'echo $TEST_FLAG',
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('1');
    expect(res.stderr).toBe('');
  }, 60_000);

  it('returns non-zero exit code for failing command', async () => {
    const res = await runtime.exec({
      cmd: 'sh -lc "exit 7"',
      timeoutMs: 20_000,
    });
    expect(res.exitCode).toBe(7);
  }, 60_000);

  it('times out long-running command when timeoutMs is set', async () => {
    const start = Date.now();
    const res = await runtime.exec({ cmd: 'sleep 5', timeoutMs: 500 });
    const elapsed = Date.now() - start;
    // In our implementation, timeout leads to exit code 124
    expect(res.exitCode).toBe(124);
    expect(elapsed).toBeLessThan(5000);
  }, 60_000);
});
