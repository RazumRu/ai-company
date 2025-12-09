import { INestApplication } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { GraphsController } from '../../../v1/graphs/controllers/graphs.controller';
import { SuggestAgentInstructionsDto } from '../../../v1/graphs/dto/agent-instructions.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const responseMock = vi.fn();

vi.mock('../../../v1/openai/openai.service', () => ({
  OpenaiService: class {
    response = responseMock;
  },
}));

describe('Agent instructions suggestion endpoint (integration)', () => {
  let app: INestApplication;
  let graphsController: GraphsController;
  let graphsService: GraphsService;
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
    graphsController = app.get(GraphsController);
    graphsService = app.get(GraphsService);
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

  it('returns suggested instructions for a running graph', async () => {
    responseMock.mockResolvedValue({
      content: 'Updated instructions (running)',
      conversationId: 'thread-running',
    });

    const graph = await graphsService.create(createMockGraphData());
    registerGraph(graph.id);

    const running = await graphsService.run(graph.id);
    expect(running.status).toBe(GraphStatus.Running);

    const response = await graphsController.suggestAgentInstructions(
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
      graphsController.suggestAgentInstructions(graph.id, 'agent-1', {
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

    const response = await graphsController.suggestAgentInstructions(
      graph.id,
      'agent-1',
      { userRequest: 'No thread provided' } as SuggestAgentInstructionsDto,
    );

    expect(responseMock).toHaveBeenCalled();
    expect(response.instructions).toBe('Generated thread');
    expect(response.threadId).toBe('generated-thread');
  });
});
