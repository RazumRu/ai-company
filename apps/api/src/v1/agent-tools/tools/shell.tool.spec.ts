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
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [ShellTool],
    }).compile();

    tool = module.get<ShellTool>(ShellTool);
  });

  describe('schema', () => {
    it('should validate required cmd field', () => {
      const validData = { cmd: 'echo "hello"' };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing cmd field', () => {
      const invalidData = {};
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should validate optional fields', () => {
      const validData = {
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
      const validData = { cmd: 'echo "hello"', timeoutMs: 1000 };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject negative timeout', () => {
      const invalidData = { cmd: 'echo "hello"', timeoutMs: -1000 };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject zero timeout', () => {
      const invalidData = { cmd: 'echo "hello"', timeoutMs: 0 };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should validate positive tail timeout', () => {
      const validData = { cmd: 'echo "hello"', tailTimeoutMs: 1000 };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject negative tail timeout', () => {
      const invalidData = { cmd: 'echo "hello"', tailTimeoutMs: -1000 };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject zero tail timeout', () => {
      const invalidData = { cmd: 'echo "hello"', tailTimeoutMs: 0 };
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
        cmd: 'echo "hello world"',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo "hello world"',
        env: {},
      });
      expect(result).toEqual({
        ...mockExecResult,
        cmd: 'echo "hello world"',
        env: undefined,
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
        cmd: 'echo $NODE_ENV',
        env: envArray,
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo $NODE_ENV',
        env: { NODE_ENV: 'test' },
      });
      expect(result).toEqual({
        ...mockExecResult,
        cmd: 'echo $NODE_ENV',
        env: envArray,
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
        ...mockExecResult,
        cmd: 'pwd',
        env: envArray,
      });
    });

    it('should throw error when runtime is not provided', async () => {
      const builtTool = tool.build({ runtime: null as any });

      await expect(
        builtTool.invoke({
          cmd: 'echo "hello"',
        }),
      ).rejects.toThrow('Runtime is required for ShellTool');
    });

    it('should handle runtime execution errors', async () => {
      const mockError = new Error('Command failed');
      mockRuntime.exec = vi.fn().mockRejectedValue(mockError);

      const config: ShellToolOptions = { runtime: mockRuntime };
      const builtTool = tool.build(config);

      await expect(
        builtTool.invoke({
          cmd: 'invalid-command',
        }),
      ).rejects.toThrow('Command failed');
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
          '- github-resource: GitHub CLI available for repository operations',
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
