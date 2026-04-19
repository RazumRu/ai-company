import type { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BaseAgentConfigurable } from '../../../../agents/agents.types';
import { ThreadStoreService } from '../../../../thread-store/services/thread-store.service';
import { ThreadStoreEntryMode } from '../../../../thread-store/thread-store.types';
import { ThreadStorePutTool } from './thread-store-put.tool';

const THREAD_EXTERNAL_ID = 'graph-1:thread-1';
const THREAD_INTERNAL_ID = 'thread-1-db-id';

type ServiceMock = {
  resolveInternalThreadId: ReturnType<typeof vi.fn>;
  putForUser: ReturnType<typeof vi.fn>;
};

const buildCfg = (
  overrides: Partial<BaseAgentConfigurable> = {},
): ToolRunnableConfig<BaseAgentConfigurable> =>
  ({
    configurable: {
      thread_id: THREAD_EXTERNAL_ID,
      thread_created_by: 'user-1',
      node_id: 'agent-node',
      ...overrides,
    } as BaseAgentConfigurable,
  }) as ToolRunnableConfig<BaseAgentConfigurable>;

describe('ThreadStorePutTool', () => {
  let tool: ThreadStorePutTool;
  let service: ServiceMock;

  beforeEach(async () => {
    service = {
      resolveInternalThreadId: vi.fn().mockResolvedValue(THREAD_INTERNAL_ID),
      putForUser: vi.fn().mockResolvedValue({
        id: 'entry-1',
        namespace: 'plan',
        key: 'root',
        value: { ok: true },
        mode: ThreadStoreEntryMode.Kv,
        authorAgentId: 'agent-node',
        tags: null,
        createdAt: '2026-04-19T10:00:00Z',
        updatedAt: '2026-04-19T10:00:00Z',
        threadId: THREAD_INTERNAL_ID,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadStorePutTool,
        { provide: ThreadStoreService, useValue: service },
      ],
    }).compile();

    tool = module.get(ThreadStorePutTool);
  });

  it('resolves the internal thread id and stamps author agent from node id', async () => {
    const result = await tool.invoke(
      { namespace: 'plan', key: 'root', value: { ok: true } },
      {},
      buildCfg(),
    );

    expect(service.resolveInternalThreadId).toHaveBeenCalledWith(
      'user-1',
      THREAD_EXTERNAL_ID,
    );
    expect(service.putForUser).toHaveBeenCalledWith(
      'user-1',
      THREAD_INTERNAL_ID,
      expect.objectContaining({
        namespace: 'plan',
        key: 'root',
        authorAgentId: 'agent-node',
      }),
    );
    expect(result.output).toEqual({
      id: 'entry-1',
      namespace: 'plan',
      key: 'root',
    });
  });

  it('prefers parent_thread_id (subagent case) when set', async () => {
    await tool.invoke(
      { namespace: 'plan', key: 'root', value: 'x' },
      {},
      buildCfg({
        thread_id: 'subagent_abc',
        parent_thread_id: THREAD_EXTERNAL_ID,
      }),
    );

    expect(service.resolveInternalThreadId).toHaveBeenCalledWith(
      'user-1',
      THREAD_EXTERNAL_ID,
    );
  });

  it('rejects writes in read-only mode', async () => {
    await expect(
      tool.invoke(
        { namespace: 'plan', key: 'root', value: 'x' },
        { readOnly: true },
        buildCfg(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.putForUser).not.toHaveBeenCalled();
  });

  it('throws when thread_created_by is missing from the agent config', async () => {
    await expect(
      tool.invoke(
        { namespace: 'plan', key: 'root', value: 'x' },
        {},
        buildCfg({ thread_created_by: undefined }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
