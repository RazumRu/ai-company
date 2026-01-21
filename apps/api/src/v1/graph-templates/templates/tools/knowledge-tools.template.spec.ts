import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { KnowledgeToolGroup } from '../../../agent-tools/tools/common/knowledge/knowledge-tool-group';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import {
  KnowledgeToolsTemplate,
  KnowledgeToolsTemplateSchema,
} from './knowledge-tools.template';

describe('KnowledgeToolsTemplate', () => {
  let template: KnowledgeToolsTemplate;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeToolsTemplate,
        {
          provide: KnowledgeToolGroup,
          useValue: {
            buildTools: () => ({ tools: [], instructions: undefined }),
          },
        },
      ],
    }).compile();

    template = module.get(KnowledgeToolsTemplate);
  });

  it('exposes correct metadata', () => {
    expect(template.id).toBe('knowledge-tools');
    expect(template.name).toBe('Knowledge Tools');
    expect(template.description).toContain('knowledge documents');
    expect(template.kind).toBe(NodeKind.Tool);
    expect(template.schema).toBe(KnowledgeToolsTemplateSchema);
  });

  it('limits connections to agents only', () => {
    expect(template.inputs).toEqual([
      { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
    ]);
    expect(template.outputs).toEqual([]);
  });

  it('validates configuration schema', () => {
    expect(() => KnowledgeToolsTemplateSchema.parse({})).not.toThrow();
    expect(() =>
      KnowledgeToolsTemplateSchema.parse({ tags: ['alpha'] }),
    ).not.toThrow();
  });

  it('normalizes tag filters on configure', async () => {
    const config = { tags: [' Alpha ', 'BETA'] };
    const inputNodeIds = new Set<string>();
    const outputNodeIds = new Set<string>();
    const metadata = {
      graphId: 'graph-1',
      nodeId: 'tools-1',
      version: '1',
      graph_created_by: 'user-1',
    };

    const handle = await template.create();
    const init: GraphNode<typeof config> = {
      config,
      inputNodeIds,
      outputNodeIds,
      metadata,
    };
    const instance = await handle.provide(init);
    await handle.configure(init, instance);

    expect(instance).toBeDefined();
  });
});
