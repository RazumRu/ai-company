import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRuntime } from '../../runtime/services/base-runtime';
import { RuntimeThreadProvider } from '../../runtime/services/runtime-thread-provider';
import { IMcpServerConfig, McpStatus } from '../agent-mcp.types';
import { BaseMcp, McpEventType, McpToolMetadata } from './base-mcp';

// Create a concrete test implementation of BaseMcp
class TestMcp extends BaseMcp<Record<string, never>> {
  private toolsMappingInternal?: Map<string, McpToolMetadata>;

  public getMcpConfig(): IMcpServerConfig {
    return {
      name: 'test-mcp',
      command: 'test',
      args: [],
      env: {},
    };
  }

  // Expose toolsMapping for testing
  public setToolsMapping(
    mapping: Map<string, McpToolMetadata> | undefined,
  ): void {
    this.toolsMappingInternal = mapping;
  }

  protected override toolsMapping(): Map<string, McpToolMetadata> | undefined {
    return this.toolsMappingInternal;
  }
}

describe('BaseMcp', () => {
  let testMcp: TestMcp;
  let mockLogger: DefaultLogger;
  let mockRuntime: BaseRuntime;
  let mockRuntimeThreadProvider: RuntimeThreadProvider;

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DefaultLogger;

    testMcp = new TestMcp(mockLogger);
    mockRuntime = {
      execStream: vi.fn(),
    } as unknown as BaseRuntime;
    mockRuntimeThreadProvider = {
      registerJob: vi.fn(),
      removeExecutor: vi.fn(),
    } as unknown as RuntimeThreadProvider;
  });

  describe('discoverTools', () => {
    const mockTools: ListToolsResult['tools'] = [
      {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'tool3',
        description: 'Tool 3',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'tool4',
        description: 'Tool 4',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    it('should return all tools when no toolsMapping is set', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: mockTools,
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );
      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(4);
      // discoverTools() returns BuiltAgentTool[], check the tool names match
      expect(result.map((t) => t.name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
        'tool4',
      ]);
    });

    it('should filter tools when toolsMapping is set', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: mockTools,
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();
      testMcp.setToolsMapping(
        new Map([
          ['tool1', {}],
          ['tool3', {}],
        ]),
      );
      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );
      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual(['tool1', 'tool3']);
    });

    it('should return empty array when toolsMapping is set but no tools match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: mockTools,
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();
      testMcp.setToolsMapping(new Map([['nonexistent', {}]]));
      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );
      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(0);
    });

    it('should return all tools when toolsMapping is empty map', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: mockTools,
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();
      testMcp.setToolsMapping(new Map());
      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );
      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(4);
      // discoverTools() returns BuiltAgentTool[], check the tool names match
      expect(result.map((t) => t.name)).toEqual([
        'tool1',
        'tool2',
        'tool3',
        'tool4',
      ]);
    });

    it('should throw error when tools are not initialized', async () => {
      await expect(testMcp.discoverTools()).rejects.toThrow(
        'MCP tools not initialized. Call initialize() first',
      );
    });
  });

  describe('toolsMapping', () => {
    it('should return undefined metadata when no toolsMapping is set', () => {
      const mapping = testMcp['toolsMapping']?.();
      const metadata = mapping?.get('tool1');

      expect(metadata).toBeUndefined();
    });

    it('should return metadata for a tool when toolsMapping is set', () => {
      const mockInstructions = vi
        .fn()
        .mockReturnValue('Instructions for tool1');
      const mockTitleGenerator = vi.fn().mockReturnValue('Tool1 Title');

      testMcp.setToolsMapping(
        new Map([
          [
            'tool1',
            {
              getDetailedInstructions: mockInstructions,
              generateTitle: mockTitleGenerator,
            },
          ],
          ['tool2', {}],
        ]),
      );

      const mapping = testMcp['toolsMapping']?.();
      const metadata = mapping?.get('tool1');

      expect(metadata).toBeDefined();
      expect(metadata?.getDetailedInstructions).toBe(mockInstructions);
      expect(metadata?.generateTitle).toBe(mockTitleGenerator);
    });

    it('should return undefined for non-existent tool', () => {
      testMcp.setToolsMapping(
        new Map([
          ['tool1', {}],
          ['tool2', {}],
        ]),
      );

      const mapping = testMcp['toolsMapping']?.();
      const metadata = mapping?.get('tool3');

      expect(metadata).toBeUndefined();
    });

    it('should work with partial metadata', () => {
      testMcp.setToolsMapping(
        new Map([
          ['tool1', { getDetailedInstructions: () => 'Instructions' }],
          ['tool2', { generateTitle: () => 'Title' }],
          ['tool3', {}],
        ]),
      );

      const mapping = testMcp['toolsMapping']?.();

      const metadata1 = mapping?.get('tool1');
      expect(metadata1?.getDetailedInstructions).toBeDefined();
      expect(metadata1?.generateTitle).toBeUndefined();

      const metadata2 = mapping?.get('tool2');
      expect(metadata2?.getDetailedInstructions).toBeUndefined();
      expect(metadata2?.generateTitle).toBeDefined();

      const metadata3 = mapping?.get('tool3');
      expect(metadata3?.getDetailedInstructions).toBeUndefined();
      expect(metadata3?.generateTitle).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should close client and clear reference', async () => {
      const mockClient = {
        close: vi.fn(),
      } as unknown as Client;
      (testMcp as any).clients = new Map([['thread-1', mockClient]]);

      await testMcp.cleanup();

      expect(mockClient.close).toHaveBeenCalled();
      expect((testMcp as any).clients.size).toBe(0);
    });

    it('should handle errors gracefully during cleanup', async () => {
      const error = new Error('Close failed');
      const mockClient = {
        close: vi.fn().mockRejectedValue(error),
      } as unknown as Client;
      (testMcp as any).clients = new Map([['thread-1', mockClient]]);

      await expect(testMcp.cleanup()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        error,
        'Error closing MCP client',
      );
    });

    it('should not throw when no clients are present', async () => {
      (testMcp as any).clients = new Map();

      await expect(testMcp.cleanup()).resolves.not.toThrow();
    });
  });

  describe('setup', () => {
    beforeEach(() => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();
    });

    it('should successfully connect within timeout', async () => {
      const config = {};

      const client = await testMcp.setup(config, mockRuntime);

      expect(client).toBeDefined();
    });

    it('should throw timeout error if connection takes too long', async () => {
      const config = {};

      vi.useFakeTimers();
      try {
        // Mock connect to never resolve (timeout should win)
        vi.spyOn(Client.prototype, 'connect').mockImplementation(
          () => new Promise<void>(() => {}),
        );

        const setupPromise = testMcp.setup(config, mockRuntime);
        const setupExpectation = expect(setupPromise).rejects.toThrow(
          'MCP initialization timed out after 300 seconds',
        );

        // BaseMcp default uses a 300s (5 minutes) connect timeout
        await vi.advanceTimersByTimeAsync(300_000);

        await setupExpectation;
      } finally {
        vi.useRealTimers();
      }
    });

    it('should cleanup client on connection error', async () => {
      const config = {};
      const connectionError = new Error('Connection failed');

      vi.spyOn(Client.prototype, 'connect').mockRejectedValue(connectionError);

      await expect(testMcp.setup(config, mockRuntime)).rejects.toThrow(
        'Connection failed',
      );
    });
  });

  describe('status', () => {
    it('should start with IDLE status', () => {
      expect(testMcp.getStatus()).toBe(McpStatus.IDLE);
      expect(testMcp.isReady).toBe(false);
    });

    it('should transition to READY after successful initialize', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );

      expect(testMcp.getStatus()).toBe(McpStatus.READY);
      expect(testMcp.isReady).toBe(true);
    });

    it('should revert to IDLE on failed initialize', async () => {
      vi.spyOn(Client.prototype, 'connect').mockRejectedValue(
        new Error('Connection failed'),
      );
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      await expect(
        testMcp.initialize(
          {},
          mockRuntimeThreadProvider,
          mockRuntime,
          'executor-1',
        ),
      ).rejects.toThrow('Connection failed');

      expect(testMcp.getStatus()).toBe(McpStatus.IDLE);
      expect(testMcp.isReady).toBe(false);
    });

    it('should transition to DESTROYED after cleanup', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [],
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );
      await testMcp.cleanup();

      expect(testMcp.getStatus()).toBe(McpStatus.DESTROYED);
      expect(testMcp.isReady).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit initialize and ready events on successful initialize', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          {
            name: 'tool1',
            description: 'Tool 1',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      } as ListToolsResult);
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      const events: McpEventType[] = [];
      testMcp.subscribe(async (event) => {
        events.push(event);
      });

      await testMcp.initialize(
        {},
        mockRuntimeThreadProvider,
        mockRuntime,
        'executor-1',
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'initialize' });
      expect(events[1]).toMatchObject({
        type: 'ready',
        data: { toolCount: 1 },
      });
    });

    it('should emit initialize event with error on failed initialize', async () => {
      vi.spyOn(Client.prototype, 'connect').mockRejectedValue(
        new Error('Connection failed'),
      );
      vi.spyOn(Client.prototype, 'close').mockResolvedValue();

      const events: McpEventType[] = [];
      testMcp.subscribe(async (event) => {
        events.push(event);
      });

      await expect(
        testMcp.initialize(
          {},
          mockRuntimeThreadProvider,
          mockRuntime,
          'executor-1',
        ),
      ).rejects.toThrow();

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'initialize' });
      expect(events[1]).toMatchObject({ type: 'initialize' });
      expect(
        (events[1] as { data: { error?: unknown } }).data.error,
      ).toBeDefined();
    });

    it('should emit destroy event on cleanup', async () => {
      const events: McpEventType[] = [];
      testMcp.subscribe(async (event) => {
        events.push(event);
      });

      await testMcp.cleanup();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'destroy' });
    });

    it('should support unsubscribe', async () => {
      const events: McpEventType[] = [];
      const unsub = testMcp.subscribe(async (event) => {
        events.push(event);
      });

      unsub();
      await testMcp.cleanup();

      expect(events).toHaveLength(0);
    });
  });
});
