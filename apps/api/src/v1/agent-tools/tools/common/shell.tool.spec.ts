import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { ShellTool, ShellToolOptions } from './shell.tool';

describe('ShellTool', () => {
  let tool: ShellTool;
  let mockRuntime: BaseRuntime;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

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

    it('should validate positive maxOutputLength', () => {
      const validData = {
        purpose: 'Testing max output length',
        command: 'echo "hello"',
        maxOutputLength: 5000,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject negative maxOutputLength', () => {
      const invalidData = {
        purpose: 'Testing max output length',
        command: 'echo "hello"',
        maxOutputLength: -1000,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject zero maxOutputLength', () => {
      const invalidData = {
        purpose: 'Testing max output length',
        command: 'echo "hello"',
        maxOutputLength: 0,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should default maxOutputLength to 10000', () => {
      const data = {
        purpose: 'Testing default max output length',
        command: 'echo "hello"',
      };
      const parsed = tool.validate(data);
      expect(parsed.maxOutputLength).toBe(10000);
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const config: ShellToolOptions = { runtime: mockRuntime };
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output } = await builtTool.invoke({
        purpose: 'Testing echo command',
        command: 'echo "hello world"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "hello world"',
          env: expect.objectContaining({
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { messageMetadata } = await builtTool.invoke({
        purpose: 'Testing echo command',
        command: 'echo "hello world"',
      });

      expect(messageMetadata?.__title).toBe('Testing echo command');
    });

    it('should execute command with environment variables', async () => {
      const mockExecResult = {
        stdout: 'test',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const environmentVariables = [{ name: 'NODE_ENV', value: 'test' }];
      const { output } = await builtTool.invoke({
        purpose: 'Testing environment variables',
        command: 'echo $NODE_ENV',
        environmentVariables,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $NODE_ENV',
          env: expect.objectContaining({
            NODE_ENV: 'test',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const environmentVariables = [{ name: 'TEST', value: 'value' }];
      const { output } = await builtTool.invoke({
        purpose: 'Testing all options',
        command: 'pwd',
        timeoutMs: 5000,
        tailTimeoutMs: 2000,
        environmentVariables,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'pwd',
          timeoutMs: 5000,
          tailTimeoutMs: 2000,
          env: expect.objectContaining({
            TEST: 'value',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
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

    it('falls back to run_id for session/workdir when thread_id is missing', async () => {
      const mockExecResult = {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await builtTool.invoke(
        {
          purpose: 'Testing run_id fallback',
          command: 'pwd',
        },
        {
          configurable: {
            run_id: 'run-xyz',
          },
        } as ToolRunnableConfig<BaseAgentConfigurable>,
      );

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'run-xyz',
          childWorkdir: 'run-xyz',
          metadata: expect.objectContaining({
            runId: 'run-xyz',
          }),
        }),
      );
    });

    it('should return error when runtime is not provided', async () => {
      const builtTool = tool.build({
        runtime: null as unknown as BaseRuntime,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing error handling',
        command: 'invalid-command',
      });

      expect(result).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Runtime not started',
      });
    });

    it('should handle "Runtime not started" error specifically', async () => {
      const mockError = new Error('Runtime not started');
      mockRuntime.exec = vi.fn().mockRejectedValue(mockError);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing runtime error',
        command: 'echo "test"',
      });

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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing environment variable conversion',
        command: 'env',
        environmentVariables: [
          { name: 'VAR1', value: 'value1' },
          { name: 'VAR2', value: 'value2' },
        ],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'env',
          env: expect.objectContaining({
            VAR1: 'value1',
            VAR2: 'value2',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing tail timeout',
        command: 'echo "test"',
        tailTimeoutMs: 3000,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          tailTimeoutMs: 3000,
          env: expect.objectContaining({
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
          metadata: expect.any(Object),
        }),
      );
    });
  });

  describe('resource integration', () => {
    it('should use environment variables from config', async () => {
      const mockExecResult = {
        stdout: 'merged',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token123',
          GIT_REPO_URL: 'https://github.com/user/repo.git',
        },
      };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing config environment variables',
        command: 'echo $GITHUB_PAT_TOKEN',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $GITHUB_PAT_TOKEN',
          env: expect.objectContaining({
            GITHUB_PAT_TOKEN: 'ghp_token123',
            GIT_REPO_URL: 'https://github.com/user/repo.git',
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
          metadata: expect.any(Object),
        }),
      );
    });

    it('should prioritize provided environment variables over config variables', async () => {
      const mockExecResult = {
        stdout: 'overridden',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = {
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_config_token',
        },
      };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing environment variable override',
        command: 'echo $GITHUB_PAT_TOKEN',
        environmentVariables: [
          { name: 'GITHUB_PAT_TOKEN', value: 'ghp_provided_token' },
        ],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo $GITHUB_PAT_TOKEN',
          env: expect.objectContaining({
            GITHUB_PAT_TOKEN: 'ghp_provided_token', // Provided value should override config value
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing without environment variables',
        command: 'echo "test"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          env: expect.objectContaining({
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
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

      const config: ShellToolOptions = { runtime: mockRuntime, env: {} };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing with empty environment variables',
        command: 'echo "test"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo "test"',
          env: expect.objectContaining({
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
          childWorkdir: 'unknown',
          createChildWorkdir: true,
          metadata: expect.any(Object),
        }),
      );
    });

    it('should use original description when no resource information provided', () => {
      const config: ShellToolOptions = { runtime: mockRuntime };

      const builtTool = tool.build(config);

      expect(builtTool.description).toBe(tool.description);
      expect(builtTool.description).not.toContain('Available Resources:');
    });
  });

  describe('maxOutputLength', () => {
    it('should trim stdout when it exceeds maxOutputLength', async () => {
      const longOutput = 'a'.repeat(15000);
      const mockExecResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing output trimming',
        command: 'echo "long output"',
        maxOutputLength: 5000,
      });

      expect(result.stdout).toHaveLength(5000);
      expect(result.stdout).toBe(longOutput.slice(-5000));
      expect(result.exitCode).toBe(0);
    });

    it('should trim stderr when it exceeds maxOutputLength', async () => {
      const longError = 'b'.repeat(15000);
      const mockExecResult = {
        stdout: '',
        stderr: longError,
        exitCode: 1,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing error trimming',
        command: 'invalid-command',
        maxOutputLength: 3000,
      });

      expect(result.stderr).toHaveLength(3000);
      expect(result.stderr).toBe(longError.slice(-3000));
      expect(result.exitCode).toBe(1);
    });

    it('should trim both stdout and stderr when they exceed maxOutputLength', async () => {
      const longStdout = 'x'.repeat(12000);
      const longStderr = 'y'.repeat(12000);
      const mockExecResult = {
        stdout: longStdout,
        stderr: longStderr,
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing both outputs trimming',
        command: 'some-command',
        maxOutputLength: 8000,
      });

      expect(result.stdout).toHaveLength(8000);
      expect(result.stdout).toBe(longStdout.slice(-8000));
      expect(result.stderr).toHaveLength(8000);
      expect(result.stderr).toBe(longStderr.slice(-8000));
    });

    it('should not trim output when it is within maxOutputLength', async () => {
      const shortOutput = 'short output';
      const mockExecResult = {
        stdout: shortOutput,
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing no trimming needed',
        command: 'echo "short"',
        maxOutputLength: 1000,
      });

      expect(result.stdout).toBe(shortOutput);
      expect(result.stdout).toHaveLength(shortOutput.length);
    });

    it('should use default maxOutputLength of 10000 when not specified', async () => {
      const longOutput = 'z'.repeat(15000);
      const mockExecResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing default max output length',
        command: 'echo "long"',
      });

      expect(result.stdout).toHaveLength(10000);
      expect(result.stdout).toBe(longOutput.slice(-10000));
    });

    it('should trim error messages when runtime execution fails', async () => {
      const longErrorMessage = 'Error: '.repeat(2000); // Very long error message
      mockRuntime.exec = vi.fn().mockRejectedValue(new Error(longErrorMessage));

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const { output: result } = await builtTool.invoke({
        purpose: 'Testing error message trimming',
        command: 'invalid-command',
        maxOutputLength: 500,
      });

      expect(result.stderr).toHaveLength(500);
      expect(result.stderr).toBe(longErrorMessage.slice(-500));
      expect(result.exitCode).toBe(1);
    });
  });

  describe('output env defaults', () => {
    it('should include no-color env defaults by default (caller can override)', async () => {
      const mockExecResult = {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      };
      mockRuntime.exec = vi.fn().mockResolvedValue(mockExecResult);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await builtTool.invoke({
        purpose: 'Testing env defaults',
        command: 'echo ok',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            NO_COLOR: '1',
            FORCE_COLOR: '0',
            CLICOLOR: '0',
            CLICOLOR_FORCE: '0',
            TERM: 'dumb',
            CI: 'true',
            NODE_NO_WARNINGS: '1',
          }),
        }),
      );
    });
  });
});
