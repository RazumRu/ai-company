import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRuntime } from '../../runtime/services/base-runtime';
import { IMcpServerConfig } from '../agent-mcp.types';
import { BaseMcp, McpToolMetadata } from './base-mcp';

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
  let mockClient: Client;

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DefaultLogger;

    mockClient = {
      listTools: vi.fn(),
      close: vi.fn(),
    } as unknown as Client;

    testMcp = new TestMcp(mockLogger);
    // Inject mock client directly for testing
    (testMcp as any).client = mockClient;
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
      vi.mocked(mockClient.listTools).mockResolvedValue({ tools: mockTools });

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
      vi.mocked(mockClient.listTools).mockResolvedValue({ tools: mockTools });
      testMcp.setToolsMapping(
        new Map([
          ['tool1', {}],
          ['tool3', {}],
        ]),
      );

      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual(['tool1', 'tool3']);
    });

    it('should return empty array when toolsMapping is set but no tools match', async () => {
      vi.mocked(mockClient.listTools).mockResolvedValue({ tools: mockTools });
      testMcp.setToolsMapping(new Map([['nonexistent', {}]]));

      const result = await testMcp.discoverTools();

      expect(result).toHaveLength(0);
    });

    it('should return all tools when toolsMapping is empty map', async () => {
      vi.mocked(mockClient.listTools).mockResolvedValue({ tools: mockTools });
      testMcp.setToolsMapping(new Map());

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

    it('should throw error when client is not initialized', async () => {
      (testMcp as any).client = undefined;

      await expect(testMcp.discoverTools()).rejects.toThrow(
        'MCP client not initialized. Call setup() first',
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
      await testMcp.cleanup();

      expect(mockClient.close).toHaveBeenCalled();
      expect((testMcp as any).client).toBeUndefined();
    });

    it('should handle errors gracefully during cleanup', async () => {
      const error = new Error('Close failed');
      vi.mocked(mockClient.close).mockRejectedValue(error);

      await expect(testMcp.cleanup()).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        error,
        'Error closing MCP client',
      );
    });

    it('should not throw when client is already undefined', async () => {
      (testMcp as any).client = undefined;

      await expect(testMcp.cleanup()).resolves.not.toThrow();
    });
  });

  describe('setup', () => {
    let mockRuntime: BaseRuntime;

    beforeEach(() => {
      mockRuntime = {
        execStream: vi.fn(),
      } as unknown as BaseRuntime;

      // Mock the Client constructor and connect method
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
    });

    it('should successfully connect within timeout', async () => {
      const config = {};

      await testMcp.setup(config, mockRuntime);

      expect((testMcp as any).client).toBeDefined();
      expect((testMcp as any).runtime).toBe(mockRuntime);
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

        // Verify client is cleaned up on timeout
        expect((testMcp as any).client).toBeUndefined();
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

      // Verify client is cleaned up on error
      expect((testMcp as any).client).toBeUndefined();
    });
  });
});
