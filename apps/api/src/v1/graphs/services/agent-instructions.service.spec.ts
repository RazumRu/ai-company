import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { OpenaiService } from '../../openai/openai.service';
import { GraphDao } from '../dao/graph.dao';
import { SuggestAgentInstructionsDto } from '../dto/agent-instructions.dto';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import { AgentInstructionsService } from './agent-instructions.service';
import { GraphRegistry } from './graph-registry';

describe('AgentInstructionsService', () => {
  let graphDao: Pick<GraphDao, 'getOne'>;
  let graphRegistry: Pick<
    GraphRegistry,
    'get' | 'filterNodesByType' | 'getNode'
  >;
  let templateRegistry: Pick<TemplateRegistry, 'getTemplate'>;
  let authContext: Pick<AuthContextService, 'checkSub'>;
  let service: AgentInstructionsService;
  let openaiService: { response: OpenaiService['response'] };
  let responseMock: ReturnType<typeof vi.fn> & OpenaiService['response'];

  beforeEach(() => {
    graphDao = {
      getOne: vi.fn(),
    };

    graphRegistry = {
      get: vi.fn(),
      filterNodesByType: vi.fn(),
      getNode: vi.fn(),
    };

    templateRegistry = {
      getTemplate: vi.fn(),
    };

    authContext = {
      checkSub: vi.fn().mockReturnValue('user-1'),
    };

    responseMock = vi.fn(async () => ({
      content: 'Updated instructions',
      conversationId: 'thread-1',
    })) as ReturnType<typeof vi.fn> & OpenaiService['response'];

    openaiService = {
      response: responseMock,
    };

    service = new AgentInstructionsService(
      graphDao as GraphDao,
      graphRegistry as GraphRegistry,
      templateRegistry as TemplateRegistry,
      authContext as AuthContextService,
      openaiService as OpenaiService,
    );
  });

  const buildGraph = (): GraphEntity =>
    ({
      id: 'graph-1',
      name: 'Test Graph',
      description: undefined,
      error: undefined,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: { instructions: 'Base instructions' },
          },
          { id: 'tool-1', template: 'sample-tool', config: {} },
        ],
        edges: [{ from: 'agent-1', to: 'tool-1' }],
      },
      status: GraphStatus.Running,
      metadata: undefined,
      createdBy: 'user-1',
      temporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as unknown as GraphEntity;

  const configureHappyPath = () => {
    const graph = buildGraph();
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);

    (templateRegistry.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: NodeKind.SimpleAgent,
    });

    (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
      edges: graph.schema.edges,
    });

    (
      graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
    ).mockReturnValue(['tool-1']);

    (graphRegistry.getNode as ReturnType<typeof vi.fn>).mockReturnValue({
      type: NodeKind.Tool,
      instance: [
        {
          name: 'Sample Tool',
          description: 'Does work',
          __instructions: 'Use it',
        },
      ],
    });
  };

  it('should return updated instructions from LLM response', async () => {
    configureHappyPath();

    const result = await service.suggest('graph-1', 'agent-1', {
      userRequest: 'Make it concise',
      threadId: 'thread-1',
    } as SuggestAgentInstructionsDto);

    expect(result.instructions).toBe('Updated instructions');
    expect(result.threadId).toBe('thread-1');
    expect(responseMock).toHaveBeenCalled();
  });

  it('should fall back to current instructions when LLM returns empty', async () => {
    configureHappyPath();
    responseMock.mockResolvedValueOnce({
      content: '   ',
      conversationId: 'thread-1',
    });

    const result = await service.suggest('graph-1', 'agent-1', {
      userRequest: 'Keep as is',
    } as SuggestAgentInstructionsDto);

    expect(result.instructions).toBe('Base instructions');
    expect(result.threadId).toBe('thread-1');
  });

  it('should generate threadId when not provided', async () => {
    configureHappyPath();

    const result = await service.suggest('graph-1', 'agent-1', {
      userRequest: 'Generate id',
    } as SuggestAgentInstructionsDto);

    expect(result.threadId).toBe('thread-1');
  });

  it('should throw when graph is not found', async () => {
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.suggest('missing', 'agent-1', {
        userRequest: 'anything',
      } as SuggestAgentInstructionsDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should throw when node is not found', async () => {
    const graph = buildGraph();
    graph.schema.nodes = [];
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);

    await expect(
      service.suggest('graph-1', 'agent-1', {
        userRequest: 'anything',
      } as SuggestAgentInstructionsDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should throw when node is not an agent', async () => {
    const graph = buildGraph();
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
    (templateRegistry.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: NodeKind.Tool,
    });

    await expect(
      service.suggest('graph-1', 'agent-1', {
        userRequest: 'anything',
      } as SuggestAgentInstructionsDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should throw when graph is not running (no compiled graph)', async () => {
    const graph = buildGraph();
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
    (templateRegistry.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: NodeKind.SimpleAgent,
    });
    (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await expect(
      service.suggest('graph-1', 'agent-1', {
        userRequest: 'anything',
      } as SuggestAgentInstructionsDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
