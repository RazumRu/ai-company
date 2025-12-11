import { INestApplication } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AiSuggestionsController } from '../../../v1/ai-suggestions/controllers/ai-suggestions.controller';
import { SuggestAgentInstructionsDto } from '../../../v1/ai-suggestions/dto/agent-instructions.dto';
import { SuggestKnowledgeContentDto } from '../../../v1/ai-suggestions/dto/knowledge-suggestions.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const responseMock = vi.fn();

vi.mock('../../../v1/openai/openai.service', () => ({
  OpenaiService: class {
    response = responseMock;
  },
}));

describe('AiSuggestionsController (integration)', () => {
  let app: INestApplication;
  let controller: AiSuggestionsController;
  let graphsService: GraphsService;
  let graphRegistry: GraphRegistry;
  const createdGraphIds: string[] = [];

  const registerGraph = (graphId: string) => {
    if (!createdGraphIds.includes(graphId)) {
      createdGraphIds.push(graphId);
    }
  };

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch {
      // Graph might not be running or may already be removed
    }

    try {
      await graphsService.delete(graphId);
    } catch {
      // Graph may already be deleted
    }
  };

  beforeAll(async () => {
    app = await createTestModule();
    controller = app.get(AiSuggestionsController);
    graphsService = app.get(GraphsService);
    graphRegistry = app.get(GraphRegistry);
  });

  beforeEach(() => {
    responseMock.mockClear();
  });

  afterEach(async () => {
    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (graphId) {
        await cleanupGraph(graphId);
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('knowledge suggestions', () => {
    it('returns generated knowledge content for a new thread', async () => {
      const graph = await graphsService.create(
        createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: 'Base instructions',
                },
              },
              {
                id: 'knowledge-1',
                template: 'simple-knowledge',
                config: { content: 'Existing knowledge' },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'knowledge-1' },
            ],
          },
        }),
      );
      registerGraph(graph.id);
      await graphsService.run(graph.id);

      responseMock.mockResolvedValueOnce({
        content: 'Generated knowledge block',
        conversationId: 'knowledge-thread-1',
      });

      const result = await controller.suggestKnowledgeContent(
        graph.id,
        'knowledge-1',
        {
          userRequest: 'Provide facts about the product',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Generated knowledge block');
      expect(result.threadId).toBe('knowledge-thread-1');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain(
        'You generate concise knowledge blocks',
      );
      expect(payload.message).toContain('Provide facts about the product');
      expect(payload.message).toContain('Existing knowledge');
      expect(params.previous_response_id).toBeUndefined();
    });

    it('continues existing knowledge suggestion thread', async () => {
      const graph = await graphsService.create(
        createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: 'Base instructions',
                },
              },
              {
                id: 'knowledge-1',
                template: 'simple-knowledge',
                config: { content: 'Existing knowledge' },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'knowledge-1' },
            ],
          },
        }),
      );
      registerGraph(graph.id);
      await graphsService.run(graph.id);

      responseMock.mockResolvedValueOnce({
        content: 'Continuation content',
        conversationId: 'knowledge-thread-2',
      });

      const result = await controller.suggestKnowledgeContent(
        graph.id,
        'knowledge-1',
        {
          userRequest: 'Continue with additional details',
          threadId: 'prev-thread',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Continuation content');
      expect(result.threadId).toBe('knowledge-thread-2');
      const lastCall = responseMock.mock.calls[
        responseMock.mock.calls.length - 1
      ] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      const [payload, params] = lastCall;
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toContain('Continue with additional details');
      expect(payload.message).toContain('Existing knowledge');
      expect(params.previous_response_id).toBe('prev-thread');
    });
  });

  describe('agent instructions', () => {
    it('returns suggested instructions for a running graph', async () => {
      responseMock.mockResolvedValue({
        content: 'Updated instructions (running)',
        conversationId: 'thread-running',
      });

      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      const running = await graphsService.run(graph.id);
      expect(running.status).toBe(GraphStatus.Running);

      const response = await controller.suggestAgentInstructions(
        graph.id,
        'agent-1',
        {
          userRequest: 'Shorten the instructions',
          threadId: 'thread-running',
        } as SuggestAgentInstructionsDto,
      );

      expect(responseMock).toHaveBeenCalled();
      expect(response.instructions).toBe('Updated instructions (running)');
      expect(response.threadId).toBe('thread-running');
    });

    it('returns error for a non-running graph', async () => {
      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      await expect(
        controller.suggestAgentInstructions(graph.id, 'agent-1', {
          userRequest: 'Add safety notes',
          threadId: 'thread-stopped',
        } as SuggestAgentInstructionsDto),
      ).rejects.toThrowError();
    });

    it('returns generated threadId when not provided', async () => {
      responseMock.mockResolvedValue({
        content: 'Generated thread',
        conversationId: 'generated-thread',
      });

      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      const running = await graphsService.run(graph.id);
      expect(running.status).toBe(GraphStatus.Running);

      const response = await controller.suggestAgentInstructions(
        graph.id,
        'agent-1',
        { userRequest: 'No thread provided' } as SuggestAgentInstructionsDto,
      );

      expect(responseMock).toHaveBeenCalled();
      expect(response.instructions).toBe('Generated thread');
      expect(response.threadId).toBe('generated-thread');
    });

    it(
      'runs graph with knowledge node and exposes knowledge in agent instructions',
      { timeout: 20000 },
      async () => {
        const graph = await graphsService.create(
          createMockGraphData({
            schema: {
              nodes: [
                {
                  id: 'agent-1',
                  template: 'simple-agent',
                  config: {
                    instructions: 'Base instructions',
                  },
                },
                {
                  id: 'knowledge-1',
                  template: 'simple-knowledge',
                  config: { content: 'Knowledge block' },
                },
                {
                  id: 'trigger-1',
                  template: 'manual-trigger',
                  config: {},
                },
              ],
              edges: [
                { from: 'trigger-1', to: 'agent-1' },
                { from: 'agent-1', to: 'knowledge-1' },
              ],
            },
          }),
        );
        registerGraph(graph.id);

        const running = await graphsService.run(graph.id);
        expect(running.status).toBe(GraphStatus.Running);

        const compiledGraph = await waitForCondition(
          () => Promise.resolve(graphRegistry.get(graph.id)),
          (result) => Boolean(result?.nodes.get('agent-1')),
          { timeout: 5000, interval: 200 },
        );

        const agentNode = compiledGraph?.nodes.get('agent-1');
        expect(agentNode).toBeDefined();
        const instructions =
          (
            agentNode?.instance as {
              currentConfig?: { instructions?: string };
            }
          )?.currentConfig?.instructions ||
          (agentNode?.config as { instructions?: string })?.instructions;
        expect(typeof instructions).toBe('string');
        expect(instructions).toContain('Knowledge block');
      },
    );
  });
});
