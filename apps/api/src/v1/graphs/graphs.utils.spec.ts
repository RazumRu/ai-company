import { describe, expect, it } from 'vitest';

import { TemplateRegistry } from '../graph-templates/services/template-registry';
import { type GraphSchemaType, NodeKind } from './graphs.types';
import { extractAgentsFromSchema } from './graphs.utils';

const createMockTemplateRegistry = (
  templateMap: Record<string, { kind: NodeKind } | undefined>,
): TemplateRegistry => {
  return {
    getTemplate: (id: string) => templateMap[id],
  } as unknown as TemplateRegistry;
};

describe('extractAgentsFromSchema', () => {
  it('should extract agent info from a simple-agent node with name and description', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: { name: 'My Agent', description: 'A helpful agent' },
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'simple-agent': { kind: NodeKind.SimpleAgent },
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toEqual([
      {
        nodeId: 'agent-1',
        name: 'My Agent',
        description: 'A helpful agent',
      },
    ]);
  });

  it('should set description to undefined when node has no description', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: { name: 'My Agent' },
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'simple-agent': { kind: NodeKind.SimpleAgent },
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('My Agent');
    expect(agents[0]!.description).toBeUndefined();
  });

  it('should exclude non-agent nodes from results', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {},
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'manual-trigger': { kind: NodeKind.Trigger },
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toEqual([]);
  });

  it('should exclude nodes whose template is unregistered', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'node-1',
          template: 'unknown-template',
          config: { name: 'Ghost Agent' },
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'unknown-template': undefined,
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toEqual([]);
  });

  it('should return empty array for schema with no nodes', () => {
    const schema: GraphSchemaType = {
      nodes: [],
      edges: [],
    };

    const registry = createMockTemplateRegistry({});

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toEqual([]);
  });

  it('should fall back to template name when config has no name', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {},
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'simple-agent': { kind: NodeKind.SimpleAgent },
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('simple-agent');
    expect(agents[0]!.description).toBeUndefined();
  });

  it('should extract multiple agents from schema with mixed node types', () => {
    const schema: GraphSchemaType = {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: { name: 'Agent Alpha', description: 'First agent' },
        },
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {},
        },
        {
          id: 'agent-2',
          template: 'simple-agent',
          config: { name: 'Agent Beta' },
        },
      ],
      edges: [],
    };

    const registry = createMockTemplateRegistry({
      'simple-agent': { kind: NodeKind.SimpleAgent },
      'manual-trigger': { kind: NodeKind.Trigger },
    });

    const agents = extractAgentsFromSchema(schema, registry);

    expect(agents).toHaveLength(2);
    expect(agents[0]).toEqual({
      nodeId: 'agent-1',
      name: 'Agent Alpha',
      description: 'First agent',
    });
    expect(agents[1]).toEqual({
      nodeId: 'agent-2',
      name: 'Agent Beta',
      description: undefined,
    });
  });
});
