import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TemplateRegistry } from '../../../v1/graph-templates/services/template-registry';
import { SimpleKnowledgeTemplate } from '../../../v1/graph-templates/templates/knowledge/simple-knowledge.template';
import type { GraphNode } from '../../../v1/graphs/graphs.types';
import { createTestModule } from '../setup';

describe('AgentKnowledge - SimpleKnowledgeTemplate (integration)', () => {
  let app: INestApplication;
  let templateRegistry: TemplateRegistry;

  beforeAll(async () => {
    app = await createTestModule();
    templateRegistry = app.get(TemplateRegistry);
  });

  afterAll(async () => {
    await app.close();
  });

  const getTemplate = (): SimpleKnowledgeTemplate => {
    const template = templateRegistry.getTemplate('simple-knowledge');
    expect(template).toBeInstanceOf(SimpleKnowledgeTemplate);
    return template as SimpleKnowledgeTemplate;
  };

  it('creates knowledge output with trimmed content', async () => {
    const template = getTemplate();

    const inputNodeIds = new Set<string>();
    const outputNodeIds = new Set<string>();
    const metadata = {
      graphId: 'graph-1',
      nodeId: 'knowledge-1',
      version: '1',
    };

    const handle = await template.create();
    const config = { content: '   Knowledge block   ' };
    const init: GraphNode<typeof config> = {
      config,
      inputNodeIds,
      outputNodeIds,
      metadata,
    };
    const instance = await handle.provide(init);
    await handle.configure(init, instance);

    expect(instance.content).toBe('Knowledge block');
  });

  it('produces independent outputs across multiple invocations', async () => {
    const template = getTemplate();

    const inputNodeIds = new Set<string>();
    const outputNodeIds = new Set<string>();

    const meta1 = { graphId: 'graph-1', nodeId: 'knowledge-1', version: '1' };
    const handle1 = await template.create();
    const config1 = { content: '   First block   ' };
    const init1: GraphNode<typeof config1> = {
      config: config1,
      inputNodeIds,
      outputNodeIds,
      metadata: meta1,
    };
    const firstInstance = await handle1.provide(init1);
    await handle1.configure(init1, firstInstance);

    const meta2 = { graphId: 'graph-1', nodeId: 'knowledge-2', version: '1' };
    const handle2 = await template.create();
    const config2 = { content: ' Second block  ' };
    const init2: GraphNode<typeof config2> = {
      config: config2,
      inputNodeIds,
      outputNodeIds,
      metadata: meta2,
    };
    const secondInstance = await handle2.provide(init2);
    await handle2.configure(init2, secondInstance);

    expect(firstInstance.content).toBe('First block');
    expect(secondInstance.content).toBe('Second block');
  });
});
