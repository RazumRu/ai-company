import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TemplateRegistry } from '../../../v1/graph-templates/services/template-registry';
import { SimpleKnowledgeTemplate } from '../../../v1/graph-templates/templates/knowledge/simple-knowledge.template';
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
    const template = templateRegistry.getTemplate<
      SimpleKnowledgeTemplate['schema'],
      Awaited<ReturnType<SimpleKnowledgeTemplate['create']>>
    >('simple-knowledge');
    expect(template).toBeInstanceOf(SimpleKnowledgeTemplate);
    return template as SimpleKnowledgeTemplate;
  };

  it('creates knowledge output with trimmed content', async () => {
    const template = getTemplate();

    const result = await template.create(
      { content: '   Knowledge block   ' },
      new Set(),
      new Set(),
      {
        graphId: 'graph-1',
        nodeId: 'knowledge-1',
        version: '1',
      },
    );

    expect(result.content).toBe('Knowledge block');
  });

  it('produces independent outputs across multiple invocations', async () => {
    const template = getTemplate();

    const first = await template.create(
      { content: '   First block   ' },
      new Set(),
      new Set(),
      {
        graphId: 'graph-1',
        nodeId: 'knowledge-1',
        version: '1',
      },
    );

    const second = await template.create(
      { content: ' Second block  ' },
      new Set(),
      new Set(),
      {
        graphId: 'graph-1',
        nodeId: 'knowledge-2',
        version: '1',
      },
    );

    expect(first.content).toBe('First block');
    expect(second.content).toBe('Second block');
  });
});
