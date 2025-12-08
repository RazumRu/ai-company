import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { ShellTool } from '../../../v1/agent-tools/tools/core/shell.tool';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';

const THREAD_ID = `shell-sessions-${Date.now()}`;
const RUNNABLE_CONFIG: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: {
    thread_id: THREAD_ID,
    run_id: `${THREAD_ID}-run`,
  },
};

describe('ShellTool persistent sessions (integration)', () => {
  let moduleRef: TestingModule;
  let runtime: BaseRuntime;
  let shellTool: ShellTool;
  let runtimeProvider: RuntimeProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [ShellTool, RuntimeProvider],
    }).compile();

    runtimeProvider = moduleRef.get(RuntimeProvider);
    shellTool = moduleRef.get(ShellTool);

    runtime = await runtimeProvider.provide({
      type: RuntimeType.Docker,
      image: environment.dockerRuntimeImage,
      autostart: true,
      recreate: true,
      containerName: `shell-session-${Date.now()}`,
    });
  }, 240_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop().catch(() => undefined);
    }

    if (moduleRef) {
      await moduleRef.close();
    }
  }, 240_000);

  it(
    'preserves environment variables and cwd within the same session',
    { timeout: 240_000 },
    async () => {
      const builtTool = shellTool.build({ runtime });

      const exportResult = await builtTool.invoke(
        {
          purpose: 'set env',
          cmd: 'export PERSIST_FOO=bar',
        },
        RUNNABLE_CONFIG,
      );
      expect(exportResult.exitCode).toBe(0);

      const envResult = await builtTool.invoke(
        {
          purpose: 'read env',
          cmd: 'echo $PERSIST_FOO',
        },
        RUNNABLE_CONFIG,
      );
      expect(envResult.exitCode).toBe(0);
      expect(envResult.stdout.trim()).toBe('bar');

      const changeDirResult = await builtTool.invoke(
        {
          purpose: 'change dir',
          cmd: 'cd /tmp',
        },
        RUNNABLE_CONFIG,
      );
      expect(changeDirResult.exitCode).toBe(0);

      const pwdResult = await builtTool.invoke(
        {
          purpose: 'confirm dir',
          cmd: 'pwd',
        },
        RUNNABLE_CONFIG,
      );
      expect(pwdResult.exitCode).toBe(0);
      expect(pwdResult.stdout.trim()).toBe('/tmp');
    },
  );

  it(
    'terminates commands that stop producing output within tailTimeoutMs',
    { timeout: 120_000 },
    async () => {
      const builtTool = shellTool.build({ runtime });

      const result = await builtTool.invoke(
        {
          purpose: 'tail timeout enforcement',
          cmd: 'echo "start"; sleep 2; echo "end"',
          tailTimeoutMs: 500,
          timeoutMs: 10_000,
        },
        RUNNABLE_CONFIG,
      );

      expect(result.exitCode).toBe(124);
      expect(result.stdout).toContain('start');
      expect(result.stdout).not.toContain('end');
      expect(result.stderr.toLowerCase()).toContain('timed out');
    },
  );
});
