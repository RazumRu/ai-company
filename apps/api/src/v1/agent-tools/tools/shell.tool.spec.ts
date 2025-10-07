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

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('shell');
    });

    it('should have correct description', () => {
      expect(tool.description).toBe(
        'Executes arbitrary shell commands inside the prepared Docker runtime. Use it for files, git, tests, builds, installs, inspection. Returns stdout, stderr, exitCode.',
      );
    });

    it('should not be marked as system tool', () => {
      expect(tool.system).toBe(false);
    });
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
        env: undefined,
      });
      expect(result).toEqual(mockExecResult);
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

      const result = await builtTool.invoke({
        cmd: 'echo $NODE_ENV',
        env: [{ key: 'NODE_ENV', value: 'test' }],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'echo $NODE_ENV',
        env: { NODE_ENV: 'test' },
      });
      expect(result).toEqual(mockExecResult);
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

      const result = await builtTool.invoke({
        cmd: 'pwd',
        timeoutMs: 5000,
        workdir: '/tmp',
        env: [{ key: 'TEST', value: 'value' }],
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: 'pwd',
        timeoutMs: 5000,
        workdir: '/tmp',
        env: { TEST: 'value' },
      });
      expect(result).toEqual(mockExecResult);
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
  });
});
