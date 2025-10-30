import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRuntime } from '../../runtime/services/base-runtime';
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
    it('should validate required purpose and cmd fields', () => {
      const validData = {
        purpose: 'Testing echo command',
        cmd: 'echo "hello"',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = { cmd: 'echo "hello"' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing cmd field', () => {
      const invalidData = { purpose: 'Testing command' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty purpose', () => {
      const invalidData = { purpose: '', cmd: 'echo "hello"' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should validate optional fields', () => {
      const validData = {
        purpose: 'Testing with all options',
        cmd: 'echo "hello"',
        timeoutMs: 5000,
        tailTimeoutMs: 2000,
        workdir: '/tmp',
        env: [
          { key: 'NODE_ENV', value: 'test' },
          { key: 'DEBUG', value: 'true' },
        ],
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should validate positive timeout', () => {
      const validData = {
        purpose: 'Testing timeout',
        cmd: 'echo "hello"',
        timeoutMs: 1000,
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject negative timeout', () => {
      const invalidData = {
        purpose: 'Testing timeout',
        cmd: 'echo "hello"',
        timeoutMs: -1000,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject zero timeout', () => {
      const invalidData = {
        purpose: 'Testing timeout',
        cmd: 'echo "hello"',
        timeoutMs: 0,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should validate positive tail timeout', () => {
      const validData = {
        purpose: 'Testing tail timeout',
        cmd: 'echo "hello"',
        tailTimeoutMs: 1000,
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject negative tail timeout', () => {
      const invalidData = {
        purpose: 'Testing tail timeout',
        cmd: 'echo "hello"',
        tailTimeoutMs: -1000,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject zero tail timeout', () => {
      const invalidData = {
        purpose: 'Testing tail timeout',
        cmd: 'echo "hello"',
        tailTimeoutMs: 0,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
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

      const result = await builtTool.invoke({
        purpose: 'Testing echo command',
        cmd: 'echo "hello world"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo "hello world"',
        env: {},
      });
      expect(result).toEqual({
        exitCode: mockExecResult.exitCode,
        stdout: mockExecResult.stdout,
        stderr: mockExecResult.stderr,
      });
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

      const envArray = [{ key: 'NODE_ENV', value: 'test' }];
      const result = await builtTool.invoke({
        purpose: 'Testing environment variables',
        cmd: 'echo $NODE_ENV',
        env: envArray,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo $NODE_ENV',
        env: { NODE_ENV: 'test' },
      });
      expect(result).toEqual({
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

      const envArray = [{ key: 'TEST', value: 'value' }];
      const result = await builtTool.invoke({
        purpose: 'Testing all options',
        cmd: 'pwd',
        timeoutMs: 5000,
        tailTimeoutMs: 2000,
        workdir: '/tmp',
        env: envArray,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'pwd',
        timeoutMs: 5000,
        tailTimeoutMs: 2000,
        workdir: '/tmp',
        env: { TEST: 'value' },
      });
      expect(result).toEqual({
        exitCode: mockExecResult.exitCode,
        stdout: mockExecResult.stdout,
        stderr: mockExecResult.stderr,
      });
    });

    it('should throw error when runtime is not provided', async () => {
      const builtTool = tool.build({
        runtime: null as unknown as BaseRuntime,
      });

      await expect(
        builtTool.invoke({
          purpose: 'Testing error handling',
          cmd: 'echo "hello"',
        }),
      ).rejects.toThrow('Runtime is required for ShellTool');
    });

    it('should handle runtime execution errors', async () => {
      const mockError = new Error('Runtime not started');
      mockRuntime.exec = vi.fn().mockRejectedValue(mockError);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      const result = await builtTool.invoke({
        purpose: 'Testing error handling',
        cmd: 'invalid-command',
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

      const result = await builtTool.invoke({
        purpose: 'Testing runtime error',
        cmd: 'echo "test"',
      });

      expect(result).toEqual({
        exitCode: 1,
        stdout: '',
        stderr: 'Runtime not started',
      });
    });

    it('should convert env array to object correctly', async () => {
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
        cmd: 'env',
        env: [
          { key: 'VAR1', value: 'value1' },
          { key: 'VAR2', value: 'value2' },
        ],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'env',
        env: {
          VAR1: 'value1',
          VAR2: 'value2',
        },
      });
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
        cmd: 'echo "test"',
        tailTimeoutMs: 3000,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo "test"',
        tailTimeoutMs: 3000,
        env: {},
      });
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
        cmd: 'echo $GITHUB_PAT_TOKEN',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo $GITHUB_PAT_TOKEN',
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token123',
          GIT_REPO_URL: 'https://github.com/user/repo.git',
        },
      });
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
        cmd: 'echo $GITHUB_PAT_TOKEN',
        env: [{ key: 'GITHUB_PAT_TOKEN', value: 'ghp_provided_token' }],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo $GITHUB_PAT_TOKEN',
        env: {
          GITHUB_PAT_TOKEN: 'ghp_provided_token', // Provided value should override config value
        },
      });
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
        cmd: 'echo "test"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo "test"',
        env: {},
      });
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
        cmd: 'echo "test"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo "test"',
        env: {},
      });
    });

    it('should enhance description with resource information', () => {
      const config: ShellToolOptions = {
        runtime: mockRuntime,
        additionalInfo:
          'Available Resources:\n- github-resource: GitHub CLI available for repository operations',
      };

      const builtTool = tool.build(config);

      expect(builtTool.description).toContain('Available Resources:');
      expect(builtTool.description).toContain(
        '- github-resource: GitHub CLI available for repository operations',
      );
    });

    it('should use original description when no resource information provided', () => {
      const config: ShellToolOptions = { runtime: mockRuntime };

      const builtTool = tool.build(config);

      expect(builtTool.description).toBe(tool.description);
      expect(builtTool.description).not.toContain('Available Resources:');
    });
  });
});
