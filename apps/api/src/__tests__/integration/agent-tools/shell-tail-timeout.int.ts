import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { ShellTool } from '../../../v1/agent-tools/tools/common/shell.tool';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { LlmModelsService } from '../../../v1/litellm/services/llm-models.service';
import { OpenaiService } from '../../../v1/openai/openai.service';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../v1/runtime/services/runtime-thread-provider';

const THREAD_ID = `shell-tail-timeout-${Date.now()}`;
const RUNNABLE_CONFIG: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: {
    thread_id: THREAD_ID,
    run_id: `${THREAD_ID}-run`,
  },
};

describe('ShellTool tail timeout behavior (integration)', () => {
  let moduleRef: TestingModule;
  let runtime: BaseRuntime;
  let shellTool: ShellTool;
  let runtimeThreadProvider: RuntimeThreadProvider;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        ShellTool,
        { provide: OpenaiService, useValue: {} },
        { provide: LitellmService, useValue: {} },
        { provide: LlmModelsService, useValue: {} },
      ],
    }).compile();
    shellTool = moduleRef.get(ShellTool);

    runtime = new DockerRuntime({ socketPath: environment.dockerSocket });

    await runtime.start({
      image: 'python:3.11-slim',
      recreate: true,
      containerName: `tail-timeout-test-${Date.now()}`,
    });

    runtimeThreadProvider = new RuntimeThreadProvider(
      {
        provide: async () => ({ runtime, created: false }),
      } as unknown as RuntimeProvider,
      {
        graphId: `graph-${Date.now()}`,
        runtimeNodeId: `runtime-${Date.now()}`,
        type: RuntimeType.Docker,
        runtimeStartParams: {
          image: 'python:3.11-slim',
        },
        temporary: true,
      },
    );
  }, 120_000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop().catch(() => undefined);
    }

    if (moduleRef) {
      await moduleRef.close();
    }
  }, 60_000);

  it(
    'does not timeout for Python heredoc commands with no immediate output',
    { timeout: 20_000 },
    async () => {
      const builtTool = shellTool.build({
        runtimeProvider: runtimeThreadProvider,
      });

      // Test actual Python heredoc - the exact scenario from user's issue
      // Python reads entire heredoc from stdin before producing any output
      // With tail timeout fix, this should NOT timeout during stdin reading
      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Test Python heredoc',
          command: `python - <<'EOF'
import csv,sys,io
data = [["col1", "col2"], ["value1", "value2"]]
for row in data:
    print(",".join(row))
EOF`,
          timeoutMs: 10_000,
          tailTimeoutMs: 3_000, // Short tail timeout to verify fix works
        },
        RUNNABLE_CONFIG,
      );

      // Exit code 0 = success, 124 = timeout
      expect(result.exitCode).toBe(0);
      expect(result.exitCode).not.toBe(124);
      expect(result.stdout).toContain('col1,col2');
      expect(result.stdout).toContain('value1,value2');
    },
  );

  it(
    'handles complex heredoc with file processing (user original scenario)',
    { timeout: 30_000 },
    async () => {
      const builtTool = shellTool.build({
        runtimeProvider: runtimeThreadProvider,
      });

      // Simulate the user's original scenario: unzip and process CSV files
      // This tests a more complex heredoc that reads and processes data
      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Test complex heredoc processing',
          command: `python - <<'PY'
import csv, sys, io
# Simulate CSV processing like the user's original issue
lines = """Area,Item,Element
US,Prices,Value
UK,CPI,Index""".splitlines()

reader = csv.reader(lines)
header = next(reader)
print(f"Header: {','.join(header)}")

for row in reader:
    print(f"Row: {','.join(row)}")
PY`,
          timeoutMs: 15_000,
          tailTimeoutMs: 5_000, // Generous tail timeout
        },
        RUNNABLE_CONFIG,
      );

      expect(result.exitCode).toBe(0);
      expect(result.exitCode).not.toBe(124);
      expect(result.stdout).toContain('Header: Area,Item,Element');
      expect(result.stdout).toContain('Row: US,Prices,Value');
      expect(result.stdout).toContain('Row: UK,CPI,Index');
    },
  );

  it(
    'still times out if command hangs after producing output',
    { timeout: 30_000 },
    async () => {
      const builtTool = shellTool.build({
        runtimeProvider: runtimeThreadProvider,
      });

      // Command produces output then hangs - should timeout
      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Test tail timeout still works',
          command: 'echo "start" && sleep 10',
          timeoutMs: 20_000,
          tailTimeoutMs: 3_000, // Should timeout after 3s of no output after "start"
        },
        RUNNABLE_CONFIG,
      );

      // Should timeout (exit 124)
      expect(result.exitCode).toBe(124);
      expect(result.stdout).toContain('start');
    },
  );
});
