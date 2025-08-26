import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RuntimeType } from '../runtime.types';
import { RuntimeOrchestrator } from './runtime-orchestrator';

describe('RuntimeOrchestrator (integration)', () => {
  const orchestrator = new RuntimeOrchestrator();
  let runtime: ReturnType<typeof orchestrator.getRuntime>;
  const image = 'alpine:3.19';

  beforeAll(async () => {
    // Get runtime instance and start it
    runtime = orchestrator.getRuntime(RuntimeType.Docker);
    await runtime.start({ image, env: { TEST_FLAG: '1' }, workdir: '/root' });
  }, 120_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop();
    }
  }, 60_000);

  it('returns a working Docker runtime instance', async () => {
    expect(runtime).toBeDefined();

    const res = await runtime.exec({
      cmd: 'echo "orchestrator test"',
      timeoutMs: 20_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('orchestrator test');
    expect(res.stderr).toBe('');
  }, 60_000);

  it('runtime instance can access environment variables set during start', async () => {
    const res = await runtime.exec({
      cmd: 'echo $TEST_FLAG',
      timeoutMs: 20_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('"1"');
    expect(res.stderr).toBe('');
  }, 60_000);

  it('runtime instance properly handles command failures', async () => {
    const res = await runtime.exec({
      cmd: 'sh -lc "exit 5"',
      timeoutMs: 20_000,
    });

    expect(res.exitCode).toBe(5);
  }, 60_000);

  it('throws error for unsupported runtime type', () => {
    expect(() => {
      // @ts-expect-error - testing unsupported runtime type
      orchestrator.getRuntime('UnsupportedType');
    }).toThrow('Runtime UnsupportedType is not supported');
  });

  it('creates separate runtime instances on multiple calls', () => {
    const runtime1 = orchestrator.getRuntime(RuntimeType.Docker);
    const runtime2 = orchestrator.getRuntime(RuntimeType.Docker);

    expect(runtime1).not.toBe(runtime2);
    expect(runtime1.constructor.name).toBe('DockerRuntime');
    expect(runtime2.constructor.name).toBe('DockerRuntime');
  });
});
