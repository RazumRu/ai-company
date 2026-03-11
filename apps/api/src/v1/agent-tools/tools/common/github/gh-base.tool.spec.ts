import { ToolRunnableConfig } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/agents.types';
import { ToolInvokeResult } from '../../base-tool';
import { GhBaseTool, GhBaseToolConfig } from './gh-base.tool';

type ResolveTokenForOwnerFn = NonNullable<
  GhBaseToolConfig['resolveTokenForOwner']
>;

// Minimal concrete subclass to test the protected resolveToken method
class TestGhTool extends GhBaseTool<unknown> {
  public name = 'test_gh_tool';
  public description = 'test';
  public get schema() {
    return z.object({});
  }
  public async invoke(): Promise<ToolInvokeResult<unknown>> {
    return { output: {} };
  }

  public async testResolveToken(
    config: GhBaseToolConfig,
    owner?: string,
    cfg?: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string> {
    return this.resolveToken(config, owner, cfg);
  }
}

describe('GhBaseTool.resolveToken', () => {
  let tool: TestGhTool;
  let mockResolveTokenForOwner: ReturnType<
    typeof vi.fn<ResolveTokenForOwnerFn>
  >;

  beforeEach(() => {
    tool = new TestGhTool();
    mockResolveTokenForOwner = vi.fn<ResolveTokenForOwnerFn>();
  });

  it('resolves token using thread_created_by when present', async () => {
    mockResolveTokenForOwner.mockResolvedValue('ghs_thread_token');
    const config: GhBaseToolConfig = {
      runtimeProvider: {} as never,
      resolveTokenForOwner: mockResolveTokenForOwner,
    };
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_created_by: 'thread-user',
        graph_created_by: 'graph-owner',
      },
    };

    const token = await tool.testResolveToken(config, 'my-org', cfg);

    expect(token).toBe('ghs_thread_token');
    expect(mockResolveTokenForOwner).toHaveBeenCalledWith(
      'my-org',
      'thread-user',
    );
  });

  it('does NOT fall back to graph_created_by when thread_created_by is absent', async () => {
    // Use a discriminating mock: returns a real token for graph-owner but null
    // for undefined. If the implementation incorrectly used graph_created_by,
    // it would get a token back and NOT throw — catching the regression.
    mockResolveTokenForOwner.mockImplementation(
      async (_owner: string, userId?: string) => {
        if (userId === 'graph-owner') return 'ghs_graph_owner_token';
        return null;
      },
    );
    const config: GhBaseToolConfig = {
      runtimeProvider: {} as never,
      resolveTokenForOwner: mockResolveTokenForOwner,
    };
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        graph_created_by: 'graph-owner',
      },
    };

    await expect(tool.testResolveToken(config, 'my-org', cfg)).rejects.toThrow(
      'No GitHub token available',
    );
    expect(mockResolveTokenForOwner).toHaveBeenCalledWith('my-org', undefined);
  });

  it('throws when no userId is present and no token resolver is configured', async () => {
    const config: GhBaseToolConfig = {
      runtimeProvider: {} as never,
    };

    await expect(tool.testResolveToken(config, 'my-org', {})).rejects.toThrow(
      'No GitHub token available',
    );
  });
});
