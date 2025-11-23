import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
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
            instructions: 'You are a helpful test agent. Answer briefly.',
            invokeModelName: 'gpt-5-mini',
            invokeModelReasoningEffort: ReasoningEffort.None,
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
          } satisfies SimpleAgentSchemaType,
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

/**
 * Poll for a condition to be met with exponential backoff
 */
export async function waitForCondition<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  options: {
    timeout?: number;
    interval?: number;
    maxInterval?: number;
  } = {},
): Promise<T> {
  const { timeout = 10000, interval = 100, maxInterval = 1000 } = options;
  const start = Date.now();
  let currentInterval = interval;

  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (condition(result)) {
        return result;
      }
    } catch (_error) {
      // Condition not met yet, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, currentInterval));
    // Exponential backoff
    currentInterval = Math.min(currentInterval * 1.5, maxInterval);
  }

  throw new Error(
    `Condition not met after ${timeout}ms. Last check at ${Date.now() - start}ms`,
  );
}
