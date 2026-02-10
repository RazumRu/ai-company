import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { ShellTool, ShellToolOptions } from './shell.tool';

vi.mock('../../../../environments', () => ({
  environment: {
    toolMaxOutputTokens: 5000,
  },
}));

describe('ShellTool', () => {
  let tool: ShellTool;
  let mockRuntime: BaseRuntime;
  let mockRuntimeThreadProvider: RuntimeThreadProvider;
  const defaultCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
    configurable: {
      thread_id: 'thread-123',
    },
  };

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;
    mockRuntimeThreadProvider = {
      provide: vi.fn().mockResolvedValue(mockRuntime),
      getRuntimeInfo: vi.fn().mockReturnValue(''),
    } as unknown as RuntimeThreadProvider;

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShellTool],
    }).compile();

    tool = module.get<ShellTool>(ShellTool);
  });

  describe('schema', () => {
    it('should validate required purpose and command fields', () => {
      const validData = {
        purpose: 'Testing echo command',
        command: 'echo "hello"',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = { command: 'echo "hello"' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing command field', () => {
      const invalidData = { purpose: 'Testing command' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty purpose', () => {
      const invalidData = { purpose: '', command: 'echo "hello"' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate optional fields', () => {
      const validData = {
        purpose: 'Testing with all options',
        command: 'echo "hello"',
        timeoutMs: 5000,
        tailTimeoutMs: 2000,
        environmentVariables: [
          { name: 'NODE_ENV', value: 'test' },
          { name: 'DEBUG', value: 'true' },
        ],
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate positive timeout', () => {
      const validData = {
        purpose: 'Testing timeout',
        command: 'echo "hello"',
        timeoutMs: 1000,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject negative timeout', () => {
      const invalidData = {
        purpose: 'Testing timeout',
        command: 'echo "hello"',
        timeoutMs: -1000,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject zero timeout', () => {
      const invalidData = {
        purpose: 'Testing timeout',
        command: 'echo "hello"',
        timeoutMs: 0,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate positive tail timeout', () => {
      const validData = {
        purpose: 'Testing tail timeout',
        command: 'echo "hello"',
        tailTimeoutMs: 1000,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject negative tail timeout', () => {
      const invalidData = {
        purpose: 'Testing tail timeout',
        command: 'echo "hello"',
        tailTimeoutMs: -1000,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject zero tail timeout', () => {
      const invalidData = {
        purpose: 'Testing tail timeout',
        command: 'echo "hello"',
        tailTimeoutMs: 0,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('shell');
    });

    it('should execute command with runtime', async () => {
      const mockExecResult = {
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output } = await builtTool.invoke(
        {
          purpose: 'Testing echo command',
          command: 'echo "hello world"',
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "hello world"',
          metadata: expect.any(Object),
        }),
      );
      expect(output).toEqual({
        exitCode: mockExecResult.exitCode,
        stdout: mockExecResult.stdout,
        stderr: mockExecResult.stderr,
      });
    });

    it('should include generated title in message metadata', async () => {
      const mockExecResult = {
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { messageMetadata } = await builtTool.invoke(
        {
          purpose: 'Testing echo command',
          command: 'echo "hello world"',
        },
        defaultCfg,
      );

      expect(messageMetadata?.__title).toBe('Testing echo command');
    });

    it('should execute command with environment variables', async () => {
      const mockExecResult = {
        stdout: 'test',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const environmentVariables = [{ name: 'NODE_ENV', value: 'test' }];
      const { output } = await builtTool.invoke(
        {
          purpose: 'Testing environment variables',
          command: 'echo $NODE_ENV',
          environmentVariables,
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $NODE_ENV',
          env: expect.objectContaining({
            NODE_ENV: 'test',
          }),
          metadata: expect.any(Object),
        }),
      );
      expect(output).toEqual({
        exitCode: mockExecResult.exitCode,
        stdout: mockExecResult.stdout,
        stderr: mockExecResult.stderr,
      });
    });

    it('should execute command with all options', async () => {
      const mockExecResult = {
        stdout: 'success',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const environmentVariables = [{ name: 'TEST', value: 'value' }];
      const { output } = await builtTool.invoke(
        {
          purpose: 'Testing all options',
          command: 'pwd',
          timeoutMs: 5000,
          tailTimeoutMs: 2000,
          environmentVariables,
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'pwd',
          timeoutMs: 5000,
          tailTimeoutMs: 2000,
          env: expect.objectContaining({
            TEST: 'value',
          }),
          metadata: expect.any(Object),
        }),
      );
      expect(output).toEqual({
        exitCode: mockExecResult.exitCode,
        stdout: mockExecResult.stdout,
        stderr: mockExecResult.stderr,
      });
    });

    it('automatically sets sessionId based on thread id (not run id)', async () => {
      const mockExecResult = {
        stdout: 'session',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing persistent session',
          command: 'echo "session"',
        },
        {
          configurable: {
            run_id: 'run-123',
            thread_id: 'thread-abc',
          },
        } as ToolRunnableConfig<BaseAgentConfigurable>,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'thread-abc',
          cmd: 'echo "session"',
          metadata: expect.objectContaining({
            threadId: 'thread-abc',
            runId: 'run-123',
          }),
        }),
      );
      expect(result.exitCode).toBe(0);
    });

    it('throws error when thread_id is missing', async () => {
      const mockExecResult = {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing missing thread id',
          command: 'pwd',
        },
        {
          configurable: {
            run_id: 'run-xyz',
          },
        } as ToolRunnableConfig<BaseAgentConfigurable>,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'Thread id is required for tool execution',
      );
    });

    it('should return error when runtime is not provided', async () => {
      vi.mocked(mockRuntimeThreadProvider.provide).mockResolvedValueOnce(
        undefined as unknown as BaseRuntime,
      );
      const builtTool = tool.build({
        runtimeProvider: mockRuntimeThreadProvider,
      });

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing error handling',
        command: 'echo "hello"',
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Runtime is required for ShellTool');
    });

    it('should handle runtime execution errors', async () => {
      const mockError = new Error('Runtime not started');
      mockRuntime.exec = vi.fn().mockRejectedValue(mockError);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing error handling',
          command: 'invalid-command',
        },
        defaultCfg,
      );

      expect(result).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Runtime not started',
      });
    });

    it('should convert environmentVariables array to object correctly', async () => {
      const mockExecResult = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing environment variable conversion',
          command: 'env',
          environmentVariables: [
            { name: 'VAR1', value: 'value1' },
            { name: 'VAR2', value: 'value2' },
          ],
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'env',
          env: expect.objectContaining({
            VAR1: 'value1',
            VAR2: 'value2',
          }),
          metadata: expect.any(Object),
        }),
      );
    });

    it('should execute command with tailTimeoutMs only', async () => {
      const mockExecResult = {
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing tail timeout',
          command: 'echo "test"',
          tailTimeoutMs: 3000,
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          tailTimeoutMs: 3000,
          metadata: expect.any(Object),
        }),
      );
    });
  });

  describe('resource integration', () => {
    it('should use environment variables from input', async () => {
      const mockExecResult = {
        stdout: 'merged',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing input environment variables',
          command: 'echo $GITHUB_PAT_TOKEN',
          environmentVariables: [
            { name: 'GITHUB_PAT_TOKEN', value: 'ghp_token123' },
            {
              name: 'GIT_REPO_URL',
              value: 'https://github.com/user/repo.git',
            },
          ],
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $GITHUB_PAT_TOKEN',
          env: expect.objectContaining({
            GITHUB_PAT_TOKEN: 'ghp_token123',
            GIT_REPO_URL: 'https://github.com/user/repo.git',
          }),
          metadata: expect.any(Object),
        }),
      );
    });

    it('should use the last value when env names repeat', async () => {
      const mockExecResult = {
        stdout: 'overridden',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing repeated environment variables',
          command: 'echo $GITHUB_PAT_TOKEN',
          environmentVariables: [
            { name: 'GITHUB_PAT_TOKEN', value: 'ghp_config_token' },
            { name: 'GITHUB_PAT_TOKEN', value: 'ghp_provided_token' },
          ],
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $GITHUB_PAT_TOKEN',
          env: expect.objectContaining({
            GITHUB_PAT_TOKEN: 'ghp_provided_token',
          }),
          metadata: expect.any(Object),
        }),
      );
    });

    it('should handle config without environment variables', async () => {
      const mockExecResult = {
        stdout: 'no env',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing without environment variables',
          command: 'echo "test"',
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          metadata: expect.any(Object),
        }),
      );
    });

    it('should handle empty environment variables object', async () => {
      const mockExecResult = {
        stdout: 'empty',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing with empty environment variables',
          command: 'echo "test"',
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          metadata: expect.any(Object),
        }),
      );
    });

    it('should use original description when no resource information provided', () => {
      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };

      const builtTool = tool.build(config);

      expect(builtTool.description).toBe(tool.description);
      expect(builtTool.description).not.toContain('Available Resources:');
    });
  });

  describe('output truncation (env-based token limit)', () => {
    // Default: toolMaxOutputTokens=5000, so maxChars = 5000 * 4 = 20000

    it('should trim stdout when it exceeds the env-based character limit', async () => {
      const longOutput = 'a'.repeat(25000);
      const mockExecResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing output trimming',
          command: 'echo "long output"',
        },
        defaultCfg,
      );

      expect(result.stdout).toHaveLength(20000);
      expect(result.stdout).toBe(longOutput.slice(-20000));
      expect(result.exitCode).toBe(0);
    });

    it('should trim stderr when it exceeds the env-based character limit', async () => {
      const longError = 'b'.repeat(25000);
      const mockExecResult = {
        stdout: '',
        stderr: longError,
        exitCode: 1,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing error trimming',
          command: 'invalid-command',
        },
        defaultCfg,
      );

      expect(result.stderr).toHaveLength(20000);
      expect(result.stderr).toBe(longError.slice(-20000));
      expect(result.exitCode).toBe(1);
    });

    it('should trim both stdout and stderr when they exceed the limit', async () => {
      const longStdout = 'x'.repeat(25000);
      const longStderr = 'y'.repeat(25000);
      const mockExecResult = {
        stdout: longStdout,
        stderr: longStderr,
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing both outputs trimming',
          command: 'some-command',
        },
        defaultCfg,
      );

      expect(result.stdout).toHaveLength(20000);
      expect(result.stdout).toBe(longStdout.slice(-20000));
      expect(result.stderr).toHaveLength(20000);
      expect(result.stderr).toBe(longStderr.slice(-20000));
    });

    it('should not trim output when it is within the limit', async () => {
      const shortOutput = 'short output';
      const mockExecResult = {
        stdout: shortOutput,
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing no trimming needed',
          command: 'echo "short"',
        },
        defaultCfg,
      );

      expect(result.stdout).toBe(shortOutput);
      expect(result.stdout).toHaveLength(shortOutput.length);
    });

    it('should respect custom toolMaxOutputTokens from environment', async () => {
      const envMock = environment as { toolMaxOutputTokens: number };
      const original = envMock.toolMaxOutputTokens;
      envMock.toolMaxOutputTokens = 1000;

      try {
        const longOutput = 'z'.repeat(10000);
        const mockExecResult = {
          stdout: longOutput,
          stderr: '',
          exitCode: 0,
        };
        mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

        const config: ShellToolOptions = {
          runtimeProvider: mockRuntimeThreadProvider,
        };
        const builtTool = tool.build(config);

        const { output: result } = await builtTool.invoke(
          {
            purpose: 'Testing custom token limit',
            command: 'echo "long"',
          },
          defaultCfg,
        );

        // 1000 tokens * 4 chars/token = 4000 chars
        expect(result.stdout).toHaveLength(4000);
        expect(result.stdout).toBe(longOutput.slice(-4000));
      } finally {
        envMock.toolMaxOutputTokens = original;
      }
    });

    it('should trim error messages when runtime execution fails', async () => {
      const longErrorMessage = 'Error: '.repeat(5000);
      mockRuntime.exec = vi.fn().mockRejectedValue(new Error(longErrorMessage));

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke(
        {
          purpose: 'Testing error message trimming',
          command: 'invalid-command',
        },
        defaultCfg,
      );

      // Default: 5000 tokens * 4 = 20000 chars
      expect(result.stderr).toHaveLength(20000);
      expect(result.stderr).toBe(longErrorMessage.slice(-20000));
      expect(result.exitCode).toBe(1);
    });
  });

  describe('output env defaults', () => {
    it('should not add default env variables (now set in Dockerfile)', async () => {
      const mockExecResult = {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtimeProvider: mockRuntimeThreadProvider,
      };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing env defaults',
          command: 'echo ok',
        },
        defaultCfg,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({}),
      );
    });
  });
});
