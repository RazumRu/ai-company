import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';

// Helper to create mock graph data for tests
export const createMockGraphData = (
  overrides?: Partial<CreateGraphDto>,
): CreateGraphDto => {
  const defaultData: CreateGraphDto = {
    name: `Test Graph ${Math.random().toString(36).slice(0, 8)}`,
    description: 'Test graph description',
    temporary: true,
    schema: {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Test Agent',
            instructions: 'You are a helpful test agent. Answer briefly.',
            invokeModelName: 'gpt-5-mini',
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
          },
        },
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {},
        },
      ],
      edges: [
        {
          from: 'trigger-1',
          to: 'agent-1',
        },
      ],
    },
  };

  return {
    ...defaultData,
    ...overrides,
    schema: overrides?.schema
      ? {
          ...defaultData.schema,
          ...overrides.schema,
          nodes: overrides.schema.nodes || defaultData.schema.nodes,
          edges: overrides.schema.edges || defaultData.schema.edges,
        }
      : defaultData.schema,
  };
};
