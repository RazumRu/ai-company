import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SimpleKnowledge } from '../../../agent-knowledge/services/simple-knowledge';
import { NodeKind } from '../../../graphs/graphs.types';
import {
  SimpleKnowledgeTemplate,
  SimpleKnowledgeTemplateSchema,
} from './simple-knowledge.template';

describe('SimpleKnowledgeTemplate', () => {
  let template: SimpleKnowledgeTemplate;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SimpleKnowledgeTemplate, SimpleKnowledge],
    }).compile();

    template = module.get(SimpleKnowledgeTemplate);
  });

  it('exposes correct metadata', () => {
    expect(template.id).toBe('simple-knowledge');
    expect(template.name).toBe('Simple knowledge');
    expect(template.description).toContain('Static knowledge block');
    expect(template.kind).toBe(NodeKind.Knowledge);
    expect(template.schema).toBe(SimpleKnowledgeTemplateSchema);
  });

  it('limits connections to agents only', () => {
    expect(template.inputs).toEqual([
      { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
    ]);
    expect(template.outputs).toEqual([]);
  });

  it('validates configuration schema', () => {
    expect(() =>
      SimpleKnowledgeTemplateSchema.parse({ content: 'Knowledge content' }),
    ).not.toThrow();

    expect(() =>
      SimpleKnowledgeTemplateSchema.parse({ content: '' }),
    ).toThrow();
  });

  it('returns trimmed knowledge content on create', async () => {
    const result = await template.create(
      { content: '   Important facts   ' },
      new Set<string>(),
      new Set<string>(),
      {
        graphId: 'graph-1',
        nodeId: 'knowledge-1',
        version: '1',
      },
    );

    expect(result.content).toBe('Important facts');
  });

  it('appends repository note when repository provided', async () => {
    const result = await template.create(
      { content: 'Repo knowledge', repository: 'git@example.com/repo.git' },
      new Set<string>(),
      new Set<string>(),
      {
        graphId: 'graph-1',
        nodeId: 'knowledge-1',
        version: '1',
      },
    );

    expect(result.content).toContain('Repo knowledge');
    expect(result.content).toContain('git@example.com/repo.git');
    expect(result.content).toContain('applies only to repository');
    expect(result.content).toContain('Do not reuse it for other repositories');
    expect(result.content).toContain('cloning or interacting with its copies');
  });
});
