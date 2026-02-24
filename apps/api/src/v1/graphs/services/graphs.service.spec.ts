import type { BaseMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  DefaultLogger,
  NotFoundException,
} from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { EntityManager } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { MessagesDao } from '../../threads/dao/messages.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import {
  CreateGraphDto,
  GraphDto,
  GraphNodesQueryDto,
  MessageDto,
  UpdateGraphDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import {
  CompiledGraph,
  CompiledGraphNode,
  GraphNodeStatus,
  GraphStatus,
  MessageRole,
  NodeKind,
} from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRevisionService } from './graph-revision.service';
import { GraphsService } from './graphs.service';
import { MessageTransformerService } from './message-transformer.service';

describe('GraphsService', () => {
  let service: GraphsService;
  let graphDao: GraphDao;
  let graphCompiler: GraphCompiler;
  let graphRegistry: GraphRegistry;
  let typeorm: TypeormService;
  let _graphCheckpointsDao: GraphCheckpointsDao;
  let _pgCheckpointSaver: PgCheckpointSaver;
  let messageTransformer: MessageTransformerService;
  let notificationsService: NotificationsService;
  let graphRevisionService: GraphRevisionService;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let logger: DefaultLogger;

  const mockUserId = 'user-123';
  const mockCtx = new AuthContextStorage({ sub: mockUserId });
  const mockGraphId = 'graph-456';

  const createMockGraphEntity = (
    overrides: Partial<GraphEntity> = {},
  ): GraphEntity => ({
    id: mockGraphId,
    name: 'Test Graph',
    description: 'A test graph',
    version: '1.0.0',
    targetVersion: '1.0.0',
    schema: {
      nodes: [
        {
          id: 'node-1',
          template: 'docker-runtime',
          config: { image: 'python:3.11' },
        },
      ],
      edges: [],
    },
    status: GraphStatus.Created,
    createdBy: mockUserId,
    temporary: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  const createMockGraphDto = (overrides: Partial<GraphDto> = {}): GraphDto => ({
    id: mockGraphId,
    name: 'Test Graph',
    description: 'A test graph',
    version: '1.0.0',
    targetVersion: '1.0.0',
    schema: {
      nodes: [
        {
          id: 'node-1',
          template: 'docker-runtime',
          config: { image: 'python:3.11' },
        },
      ],
      edges: [],
    },
    status: GraphStatus.Created,
    runningThreads: 0,
    totalThreads: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createMockCompiledGraph = (): CompiledGraph => {
    const instance = { container: 'test-container' };
    const nodes = new Map<string, CompiledGraphNode>([
      [
        'node-1',
        {
          id: 'node-1',
          type: NodeKind.Runtime,
          template: 'test-runtime',
          config: {},
          instance,
          handle: {
            provide: async () => instance,
            configure: vi.fn(),
            destroy: vi.fn(),
          },
        },
      ],
    ]);

    const state = {
      getSnapshots: vi.fn().mockImplementation(() =>
        Array.from(nodes.values()).map((node) => ({
          id: node.id,
          name: node.id,
          template: node.template,
          type: node.type,
          status: GraphNodeStatus.Idle,
          config: node.config,
          error: null,
        })),
      ),
      handleGraphDestroyed: vi.fn(),
    } as unknown as CompiledGraph['state'];

    return {
      nodes,
      edges: [],
      state,
      status: GraphStatus.Running,
      destroy: vi.fn().mockResolvedValue(undefined),
    } as CompiledGraph;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphsService,
        {
          provide: GraphDao,
          useValue: {
            create: vi.fn(),
            getOne: vi.fn(),
            getAll: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
          },
        },
        {
          provide: GraphCompiler,
          useValue: {
            compile: vi.fn(),
            validateSchema: vi.fn(),
          },
        },
        {
          provide: GraphRegistry,
          useValue: {
            register: vi.fn(),
            get: vi.fn(),
            getNode: vi.fn(),
            destroy: vi.fn(),
            setStatus: vi.fn(),
            getStatus: vi.fn().mockReturnValue(undefined),
          },
        },
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
            getAll: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
            delete: vi.fn(),
            countByGraphIds: vi.fn(),
          },
        },
        {
          provide: MessagesDao,
          useValue: {
            delete: vi.fn(),
          },
        },
        {
          provide: TypeormService,
          useValue: {
            trx: vi.fn(),
          },
        },
        {
          provide: GraphCheckpointsDao,
          useValue: {
            getOne: vi.fn(),
            getAll: vi.fn(),
          },
        },
        {
          provide: PgCheckpointSaver,
          useValue: {
            serde: {
              loadsTyped: vi.fn(),
            },
          },
        },
        {
          provide: MessageTransformerService,
          useValue: {
            transformMessageToDto: vi.fn(),
            transformMessagesToDto: vi.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            emit: vi.fn(),
          },
        },
        {
          provide: GraphRevisionService,
          useValue: {
            queueRevision: vi.fn(),
            getRevisions: vi.fn(),
            generateNextVersion: vi.fn(),
            enqueueRevisionProcessing: vi.fn(),
            isVersionLess: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: DefaultLogger,
          useValue: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GraphsService>(GraphsService);
    graphDao = module.get<GraphDao>(GraphDao);
    graphCompiler = module.get<GraphCompiler>(GraphCompiler);
    graphRegistry = module.get<GraphRegistry>(GraphRegistry);
    typeorm = module.get<TypeormService>(TypeormService);
    _graphCheckpointsDao = module.get<GraphCheckpointsDao>(GraphCheckpointsDao);
    _pgCheckpointSaver = module.get<PgCheckpointSaver>(PgCheckpointSaver);
    messageTransformer = module.get<MessageTransformerService>(
      MessageTransformerService,
    );
    notificationsService =
      module.get<NotificationsService>(NotificationsService);
    graphRevisionService =
      module.get<GraphRevisionService>(GraphRevisionService);
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    messagesDao = module.get<MessagesDao>(MessagesDao);
    logger = module.get<DefaultLogger>(DefaultLogger);
    vi.mocked(threadsDao.getOne).mockResolvedValue(null);
    vi.mocked(threadsDao.create).mockResolvedValue({} as any);
    vi.mocked(threadsDao.getAll).mockResolvedValue([]);
    vi.mocked(threadsDao.updateById).mockResolvedValue(null as any);
    vi.mocked(threadsDao.deleteById).mockResolvedValue(undefined);
    vi.mocked(threadsDao.delete).mockResolvedValue(undefined as any);
    vi.mocked(threadsDao.countByGraphIds).mockResolvedValue(new Map());
    vi.mocked(messagesDao.delete).mockResolvedValue(undefined as any);
    vi.mocked(graphRegistry.getStatus).mockReturnValue(undefined);
    vi.mocked(notificationsService.emit).mockResolvedValue(void 0 as any);
    vi.mocked(graphRevisionService.queueRevision).mockResolvedValue({
      id: 'revision-1',
      graphId: mockGraphId,
      baseVersion: '1.0.0',
      toVersion: '1.0.1',
      status: 'pending',
      configDiff: [],
      clientConfig: {} as any,
      newConfig: {} as any,
      createdBy: mockUserId,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      entity: {
        id: 'revision-1',
        graphId: mockGraphId,
        baseVersion: '1.0.0',
        toVersion: '1.0.1',
        status: 'pending',
        configDiff: [],
        clientConfig: {} as any,
        newConfig: {} as any,
        createdBy: mockUserId,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    } as any);
    vi.mocked(graphRevisionService.enqueueRevisionProcessing).mockResolvedValue(
      undefined,
    );
    vi.mocked(graphRevisionService.getRevisions).mockResolvedValue([]);
    vi.mocked(graphRevisionService.generateNextVersion).mockImplementation(
      (version) => {
        const parts = version.split('.');
        const lastIndex = parts.length - 1;
        const lastValue = parseInt(parts[lastIndex] ?? '0', 10) || 0;
        parts[lastIndex] = String(lastValue + 1);
        return parts.join('.');
      },
    );

    // Setup default mocks
    vi.mocked(typeorm.trx).mockImplementation(async (callback) => {
      const mockEntityManager = {
        createQueryBuilder: vi.fn().mockReturnValue({
          setLock: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          getOne: vi.fn().mockImplementation(() => {
            // Return the mocked graph from graphDao.getOne
            return vi.mocked(graphDao.getOne).getMockImplementation()?.({
              id: mockGraphId,
              createdBy: mockUserId,
            });
          }),
        }),
      } as unknown as EntityManager;
      return callback(mockEntityManager);
    });

    // Mock message transformer to transform BaseMessage instances
    const transformMessage = (msg: BaseMessage): MessageDto => {
      const typeName =
        (msg.constructor as unknown as { name?: string })?.name ??
        'BaseMessage';
      const obj = msg as unknown as Record<string, unknown>;

      if (typeName === 'HumanMessage') {
        return {
          role: MessageRole.Human,
          content: String(obj['content'] ?? ''),
          additionalKwargs: obj['additional_kwargs'] as
            | Record<string, unknown>
            | undefined,
        };
      }

      if (typeName === 'AIMessage' || typeName === 'AIMessageChunk') {
        return {
          role: MessageRole.AI,
          content: String(obj['content'] ?? ''),
          id: typeof obj['id'] === 'string' ? obj['id'] : undefined,
          // Keep this mock minimal; detailed toolCall mapping is tested elsewhere.
          toolCalls: undefined,
          additionalKwargs: obj['additional_kwargs'] as
            | Record<string, unknown>
            | undefined,
        };
      }

      return {
        role: MessageRole.System,
        content: String(obj['content'] ?? ''),
        additionalKwargs: obj['additional_kwargs'] as
          | Record<string, unknown>
          | undefined,
      };
    };

    vi.mocked(messageTransformer.transformMessageToDto).mockImplementation(
      transformMessage as unknown as typeof messageTransformer.transformMessageToDto,
    );
    vi.mocked(messageTransformer.transformMessagesToDto).mockImplementation(
      (messages) => (messages as BaseMessage[]).map((m) => transformMessage(m)),
    );
  });

  describe('create', () => {
    it('should create a new graph successfully', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        description: 'A new test graph',
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [],
        },
        metadata: {
          graphId: 'new-graph',
          name: 'New Graph',
          version: '1.0.0',
        },
      };

      const expectedEntity = createMockGraphEntity({
        id: 'new-graph-id',
        name: 'New Graph',
        description: 'A new test graph',
        status: GraphStatus.Created,
        createdBy: mockUserId,
      });

      const expectedGraph = createMockGraphDto({
        id: 'new-graph-id',
        name: 'New Graph',
        description: 'A new test graph',
        status: GraphStatus.Created,
      });

      vi.mocked(graphDao.create).mockResolvedValue(expectedEntity);

      const result = await service.create(mockCtx, createData);

      expect(result).toMatchObject(expectedGraph);
      expect(graphDao.create).toHaveBeenCalledWith(
        {
          ...createData,
          status: GraphStatus.Created,
          createdBy: mockUserId,
          temporary: false,
          version: '1.0.0',
          targetVersion: '1.0.0',
        },
        expect.any(Object), // EntityManager
      );
    });

    it('should handle creation errors', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        schema: {
          nodes: [],
          edges: [],
        },
        metadata: {
          graphId: 'new-graph',
          version: '1.0.0',
        },
      };

      const error = new Error('Database error');
      vi.mocked(graphDao.create).mockRejectedValue(error);

      await expect(service.create(mockCtx, createData)).rejects.toThrow(
        'Database error',
      );
    });

    it('should validate schema before creating graph', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [],
        },
        metadata: {
          graphId: 'new-graph',
          version: '1.0.0',
        },
      };

      const expectedEntity = createMockGraphEntity({
        id: 'new-graph-id',
        name: 'New Graph',
        status: GraphStatus.Created,
        createdBy: mockUserId,
      });

      vi.mocked(graphDao.create).mockResolvedValue(expectedEntity);
      vi.mocked(graphCompiler.validateSchema).mockImplementation(() => {});

      await service.create(mockCtx, createData);

      expect(graphCompiler.validateSchema).toHaveBeenCalledWith(
        createData.schema,
      );
    });

    it('should throw BadRequestException for invalid schema', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'invalid-template',
              config: {},
            },
          ],
          edges: [],
        },
        metadata: {
          graphId: 'new-graph',
          version: '1.0.0',
        },
      };

      const validationError = new BadRequestException(
        "Template 'invalid-template' is not registered",
      );
      vi.mocked(graphCompiler.validateSchema).mockImplementation(() => {
        throw validationError;
      });

      await expect(service.create(mockCtx, createData)).rejects.toThrow(
        validationError,
      );
      expect(graphDao.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for duplicate node IDs', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        schema: {
          nodes: [
            {
              id: 'duplicate-id',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
            {
              id: 'duplicate-id',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [],
        },
        metadata: {
          graphId: 'new-graph',
          version: '1.0.0',
        },
      };

      const validationError = new BadRequestException(
        'Duplicate node IDs found in graph schema',
      );
      vi.mocked(graphCompiler.validateSchema).mockImplementation(() => {
        throw validationError;
      });

      await expect(service.create(mockCtx, createData)).rejects.toThrow(
        validationError,
      );
      expect(graphDao.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid edge references', async () => {
      const createData: CreateGraphDto = {
        name: 'New Graph',
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [
            {
              from: 'node-1',
              to: 'non-existent-node',
            },
          ],
        },
        metadata: {
          graphId: 'new-graph',
          version: '1.0.0',
        },
      };

      const validationError = new BadRequestException(
        'Edge references non-existent target node: non-existent-node',
      );
      vi.mocked(graphCompiler.validateSchema).mockImplementation(() => {
        throw validationError;
      });

      await expect(service.create(mockCtx, createData)).rejects.toThrow(
        validationError,
      );
      expect(graphDao.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return graph when found', async () => {
      const expectedEntity = createMockGraphEntity();
      const expectedGraph = createMockGraphDto();
      vi.mocked(graphDao.getOne).mockResolvedValue(expectedEntity);

      const result = await service.findById(mockCtx, mockGraphId);

      expect(result).toMatchObject(expectedGraph);
      expect(graphDao.getOne).toHaveBeenCalledWith({
        id: mockGraphId,
        createdBy: mockUserId,
      });
    });

    it('should throw NotFoundException when graph not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(service.findById(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAll', () => {
    it('should return all graphs for user', async () => {
      const entities = [
        createMockGraphEntity({ id: 'graph-1' }),
        createMockGraphEntity({ id: 'graph-2' }),
      ];
      const expectedGraphs = [
        createMockGraphDto({ id: 'graph-1' }),
        createMockGraphDto({ id: 'graph-2' }),
      ];
      vi.mocked(graphDao.getAll).mockResolvedValue(entities);

      const result = await service.getAll(mockCtx);

      expect(result).toMatchObject(expectedGraphs);
      expect(graphDao.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: mockUserId,
        }),
      );
    });

    it('should return empty array when no graphs found', async () => {
      vi.mocked(graphDao.getAll).mockResolvedValue([]);

      const result = await service.getAll(mockCtx);

      expect(result).toEqual([]);
    });
  });

  describe('getCompiledNodes', () => {
    it('should throw NotFoundException when graph is missing', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(
        service.getCompiledNodes(
          mockCtx,
          mockGraphId,
          {} as GraphNodesQueryDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when compiled graph is not available', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(createMockGraphEntity());
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);

      await expect(
        service.getCompiledNodes(
          mockCtx,
          mockGraphId,
          {} as GraphNodesQueryDto,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return compiled nodes with statuses', async () => {
      const compiledGraph = createMockCompiledGraph();
      const stateGetSnapshots = compiledGraph.state
        .getSnapshots as unknown as ReturnType<typeof vi.fn>;
      stateGetSnapshots.mockReturnValue([
        {
          id: 'node-1',
          name: 'node-1',
          template: 'manual-trigger',
          type: NodeKind.Trigger,
          status: GraphNodeStatus.Running,
          config: { enabled: true },
          error: null,
          metadata: {
            threadId: undefined,
            runId: undefined,
            parentThreadId: undefined,
            source: undefined,
          },
        },
      ]);

      vi.mocked(graphDao.getOne).mockResolvedValue(
        createMockGraphEntity({ status: GraphStatus.Running }),
      );
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);

      const result = await service.getCompiledNodes(
        mockCtx,
        mockGraphId,
        {} as GraphNodesQueryDto,
      );

      expect(result).toEqual([
        {
          id: 'node-1',
          name: 'node-1',
          template: 'manual-trigger',
          type: NodeKind.Trigger,
          status: GraphNodeStatus.Running,
          config: { enabled: true },
          error: null,
          metadata: {
            threadId: undefined,
            runId: undefined,
            parentThreadId: undefined,
            source: undefined,
          },
        },
      ]);
      expect(stateGetSnapshots).toHaveBeenCalledWith(undefined, undefined);

      stateGetSnapshots.mockClear();
      stateGetSnapshots.mockReturnValue([
        {
          id: 'node-1',
          name: 'node-1',
          template: 'manual-trigger',
          type: NodeKind.Trigger,
          status: GraphNodeStatus.Idle,
          config: { enabled: true },
          error: 'failed',
          metadata: {
            threadId: 'thread-123',
            runId: 'run-456',
            parentThreadId: undefined,
            source: undefined,
          },
        },
      ]);

      await service.getCompiledNodes(mockCtx, mockGraphId, {
        threadId: 'thread-123',
        runId: 'run-456',
      } as GraphNodesQueryDto);

      expect(stateGetSnapshots).toHaveBeenLastCalledWith(
        'thread-123',
        'run-456',
      );
    });
  });

  describe('update', () => {
    it('should update name and description synchronously without creating revision', async () => {
      const updateData: UpdateGraphDto = {
        name: 'Updated Graph',
        description: 'Updated description',
        currentVersion: '1.0.0',
      };

      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Created,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphDao.updateById).mockResolvedValue(
        createMockGraphEntity({
          name: 'Updated Graph',
          description: 'Updated description',
        }),
      );

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(result.revision).toBeUndefined();
      expect(result.graph.version).toBe(mockGraph.version);
      expect(result.graph.name).toBe('Updated Graph');
      expect(result.graph.description).toBe('Updated description');

      expect(graphRevisionService.queueRevision).not.toHaveBeenCalled();
      expect(
        graphRevisionService.enqueueRevisionProcessing,
      ).not.toHaveBeenCalled();
      expect(graphDao.updateById).toHaveBeenCalledWith(
        mockGraphId,
        { name: 'Updated Graph', description: 'Updated description' },
        expect.any(Object),
      );
    });

    it('should only update changed fields and ignore undefined values', async () => {
      const updateData: UpdateGraphDto = {
        name: 'Updated Graph',
        description: undefined,
        currentVersion: '1.0.0',
      };

      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Created,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphDao.updateById).mockResolvedValue(
        createMockGraphEntity({ name: 'Updated Graph' }),
      );

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(result.revision).toBeUndefined();
      expect(graphRevisionService.queueRevision).not.toHaveBeenCalled();
      // Only name should be in the sync update (description is undefined → unchanged)
      expect(graphDao.updateById).toHaveBeenCalledWith(
        mockGraphId,
        { name: 'Updated Graph' },
        expect.any(Object),
      );
    });

    it('should throw NotFoundException when graph not found', async () => {
      const updateData: UpdateGraphDto = {
        name: 'Updated Graph',
        currentVersion: '1.0.0',
      };
      vi.mocked(graphDao.updateById).mockResolvedValue(null);

      await expect(
        service.update(mockCtx, mockGraphId, updateData),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when currentVersion is missing', async () => {
      const updateData = {
        name: 'Updated Graph',
      } as unknown as UpdateGraphDto;

      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      await expect(
        service.update(mockCtx, mockGraphId, updateData),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when currentVersion mismatches', async () => {
      const updateData: UpdateGraphDto = {
        name: 'Updated Graph',
        currentVersion: '0.9.0',
      };

      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      await expect(
        service.update(mockCtx, mockGraphId, updateData),
      ).rejects.toThrow(BadRequestException);
    });

    it('should queue revision when updating running graph schema', async () => {
      const updateData: UpdateGraphDto = {
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.12' },
            },
          ],
          edges: [],
        },
        currentVersion: '1.0.0',
      };

      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(graphRevisionService.queueRevision).toHaveBeenCalledWith(
        mockCtx,
        mockGraph,
        '1.0.0',
        expect.objectContaining({
          schema: updateData.schema,
          name: mockGraph.name,
          description: mockGraph.description ?? null,
          temporary: mockGraph.temporary,
        }),
        expect.any(Object),
        { enqueueImmediately: false },
      );
      expect(
        graphRevisionService.enqueueRevisionProcessing,
      ).toHaveBeenCalledWith({
        id: 'revision-1',
        graphId: mockGraphId,
      });
      // Should return current graph state with the created revision
      expect(result.graph.version).toBe('1.0.0');
      expect(result.revision).toBeDefined();
      expect(graphDao.updateById).not.toHaveBeenCalled();
    });

    it('should not queue revision when running graph schema is unchanged', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      const updateData: UpdateGraphDto = {
        schema: mockGraph.schema,
        currentVersion: mockGraph.version,
      };

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(graphRevisionService.queueRevision).not.toHaveBeenCalled();
      expect(
        graphRevisionService.enqueueRevisionProcessing,
      ).not.toHaveBeenCalled();
      expect(graphDao.updateById).not.toHaveBeenCalled();
      expect(result.graph.version).toBe(mockGraph.version);
      expect(result.revision).toBeUndefined();
    });

    it('should apply name synchronously even if same schema is provided', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      const updateData: UpdateGraphDto = {
        schema: mockGraph.schema,
        name: 'Updated Graph',
        currentVersion: mockGraph.version,
      };

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphDao.updateById).mockResolvedValue(
        createMockGraphEntity({ name: 'Updated Graph' }),
      );

      const result = await service.update(mockCtx, mockGraphId, updateData);

      // Name is applied synchronously; schema unchanged → no revision
      expect(result.revision).toBeUndefined();
      expect(graphRevisionService.queueRevision).not.toHaveBeenCalled();
      expect(graphDao.updateById).toHaveBeenCalledWith(
        mockGraphId,
        { name: 'Updated Graph' },
        expect.any(Object),
      );
    });

    it('should queue revision when updating compiling graph schema', async () => {
      const updateData: UpdateGraphDto = {
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.12' },
            },
          ],
          edges: [],
        },
        currentVersion: '1.0.0',
      };

      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(graphRevisionService.queueRevision).toHaveBeenCalledWith(
        mockCtx,
        mockGraph,
        '1.0.0',
        expect.objectContaining({
          schema: updateData.schema,
          name: mockGraph.name,
          description: mockGraph.description ?? null,
          temporary: mockGraph.temporary,
        }),
        expect.any(Object),
        { enqueueImmediately: false },
      );
      expect(
        graphRevisionService.enqueueRevisionProcessing,
      ).toHaveBeenCalledWith({
        id: 'revision-1',
        graphId: mockGraphId,
      });
      // Should return current graph state with created revision
      expect(result.graph.version).toBe('1.0.0');
      expect(result.revision).toBeDefined();
      expect(graphDao.updateById).not.toHaveBeenCalled();
    });

    it('should create a revision when updating non-running graph schema', async () => {
      const updateData: UpdateGraphDto = {
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.12' },
            },
          ],
          edges: [],
        },
        currentVersion: '1.0.0',
      };

      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(result.revision).toBeDefined();
      expect(graphRevisionService.queueRevision).toHaveBeenCalledWith(
        mockCtx,
        mockGraph,
        '1.0.0',
        expect.objectContaining({
          schema: updateData.schema,
          name: mockGraph.name,
          description: mockGraph.description ?? null,
          temporary: mockGraph.temporary,
        }),
        expect.any(Object),
        { enqueueImmediately: false },
      );
      expect(graphDao.updateById).not.toHaveBeenCalled();
    });

    it('should not increment version when non-running graph schema is unchanged', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });
      const updateData: UpdateGraphDto = {
        schema: mockGraph.schema,
        currentVersion: mockGraph.version,
      };

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);

      const result = await service.update(mockCtx, mockGraphId, updateData);

      expect(graphDao.updateById).not.toHaveBeenCalled();
      expect(result.graph.version).toBe(mockGraph.version);
      expect(result.revision).toBeUndefined();
    });

    it('should apply name synchronously without revision when schema unchanged on non-running graph', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });
      const updateData: UpdateGraphDto = {
        schema: mockGraph.schema,
        name: 'Updated Graph',
        currentVersion: mockGraph.version,
      };

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphDao.updateById).mockResolvedValue(
        createMockGraphEntity({ name: 'Updated Graph' }),
      );

      const result = await service.update(mockCtx, mockGraphId, updateData);

      // Name is applied synchronously; schema unchanged → no revision
      expect(result.revision).toBeUndefined();
      expect(graphRevisionService.queueRevision).not.toHaveBeenCalled();
      expect(graphDao.updateById).toHaveBeenCalledWith(
        mockGraphId,
        { name: 'Updated Graph' },
        expect.any(Object),
      );
    });
  });

  describe('delete', () => {
    it('should delete graph successfully when not running', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);

      await service.delete(mockCtx, mockGraphId);

      expect(graphDao.getOne).toHaveBeenCalledWith({
        id: mockGraphId,
        createdBy: mockUserId,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(mockGraphId);
      expect(graphRegistry.destroy).not.toHaveBeenCalled();
    });

    it('should cascade soft-delete threads and messages in batch', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const thread1 = { id: 'thread-1', graphId: mockGraphId } as any;
      const thread2 = { id: 'thread-2', graphId: mockGraphId } as any;

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(threadsDao.getAll).mockResolvedValue([thread1, thread2]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);

      await service.delete(mockCtx, mockGraphId);

      expect(threadsDao.getAll).toHaveBeenCalledWith({ graphId: mockGraphId });
      expect(messagesDao.delete).toHaveBeenCalledWith({
        threadIds: ['thread-1', 'thread-2'],
      });
      expect(threadsDao.delete).toHaveBeenCalledWith({ graphId: mockGraphId });
      expect(graphDao.deleteById).toHaveBeenCalledWith(mockGraphId);
    });

    it('should destroy running graph before deletion', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Running });
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(createMockCompiledGraph());
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      vi.mocked(graphDao.updateById).mockResolvedValue(
        createMockGraphEntity({ status: GraphStatus.Stopped }),
      );
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);

      await service.delete(mockCtx, mockGraphId);

      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
      expect(graphDao.deleteById).toHaveBeenCalledWith(mockGraphId);
    });

    it('should throw NotFoundException when graph not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(service.delete(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('run', () => {
    it('should run graph successfully', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compiledGraph = createMockCompiledGraph();
      const compilingEntity = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });
      const updatedEntity = createMockGraphEntity({
        status: GraphStatus.Running,
      });
      const updatedGraph = createMockGraphDto({
        status: GraphStatus.Running,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(compilingEntity)
        .mockResolvedValueOnce(updatedEntity);

      const result = await service.run(mockCtx, mockGraphId);

      expect(result).toMatchObject(updatedGraph);
      expect(graphCompiler.compile).toHaveBeenCalledWith(graph, {
        graphId: graph.id,
        name: graph.name,
        version: graph.version,
      });
      // GraphRegistry.register is now called by GraphCompiler, not by service
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        1,
        mockGraphId,
        expect.objectContaining({ status: GraphStatus.Compiling }),
      );
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        2,
        mockGraphId,
        expect.objectContaining({ status: GraphStatus.Running }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: NotificationEvent.Graph,
          graphId: mockGraphId,
          data: expect.objectContaining({
            status: GraphStatus.Compiling,
          }),
        }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: NotificationEvent.Graph,
          graphId: mockGraphId,
          data: expect.objectContaining({
            status: GraphStatus.Running,
          }),
        }),
      );
    });

    it('should throw BadRequestException when graph is already running', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.getStatus).mockReturnValueOnce(
        GraphStatus.Running,
      );

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when graph not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle compilation errors and cleanup', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compilationError = new Error('Compilation failed');
      const compilingEntity = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });
      const errorEntity = createMockGraphEntity({
        status: GraphStatus.Error,
        error: 'Compilation failed',
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockRejectedValue(compilationError);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(compilingEntity)
        .mockResolvedValueOnce(errorEntity);

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        'Compilation failed',
      );

      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        1,
        mockGraphId,
        expect.objectContaining({ status: GraphStatus.Compiling }),
      );
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        2,
        mockGraphId,
        expect.objectContaining({
          status: GraphStatus.Error,
          error: 'Compilation failed',
        }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            status: GraphStatus.Compiling,
          }),
        }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            status: GraphStatus.Error,
          }),
        }),
      );
    });

    it('should stop running threads when graph fails to start', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compilationError = new Error('Compilation failed');
      const compilingEntity = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockRejectedValue(compilationError);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(compilingEntity)
        .mockResolvedValueOnce(
          createMockGraphEntity({
            status: GraphStatus.Error,
            error: 'Compilation failed',
          }),
        );

      const runningThread = {
        id: 'thread-1',
        externalThreadId: 'external-1',
      } as any;
      vi.mocked(threadsDao.getAll).mockResolvedValue([runningThread]);
      vi.mocked(threadsDao.updateById).mockResolvedValue(runningThread);

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        'Compilation failed',
      );

      expect(threadsDao.getAll).toHaveBeenCalledWith({
        graphId: mockGraphId,
        status: ThreadStatus.Running,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(runningThread.id, {
        status: ThreadStatus.Stopped,
      });
      // ThreadUpdate(Stooped) is emitted by GraphStateManager, not GraphsService.
    });

    it('should cleanup registry when database update fails', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compiledGraph = createMockCompiledGraph();
      const compilingEntity = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(compilingEntity)
        .mockResolvedValueOnce(null);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );

      // GraphRegistry.register is now called by GraphCompiler, not by service
      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        1,
        mockGraphId,
        expect.objectContaining({ status: GraphStatus.Compiling }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            status: GraphStatus.Compiling,
          }),
        }),
      );
    });

    it('should cleanup registry when compilation fails after registration', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compiledGraph = createMockCompiledGraph();
      const compilationError = new Error('Compilation failed');
      const compilingEntity = createMockGraphEntity({
        status: GraphStatus.Compiling,
      });
      const errorEntity = createMockGraphEntity({
        status: GraphStatus.Error,
        error: 'Compilation failed',
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);
      vi.mocked(graphCompiler.compile).mockRejectedValue(compilationError);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(compilingEntity)
        .mockResolvedValueOnce(errorEntity);

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        'Compilation failed',
      );

      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        1,
        mockGraphId,
        expect.objectContaining({ status: GraphStatus.Compiling }),
      );
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        2,
        mockGraphId,
        expect.objectContaining({
          status: GraphStatus.Error,
          error: 'Compilation failed',
        }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            status: GraphStatus.Compiling,
          }),
        }),
      );
      expect(notificationsService.emit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            status: GraphStatus.Error,
          }),
        }),
      );
    });
  });

  describe('destroy', () => {
    it('should destroy running graph successfully', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Running });
      const compiledGraph = createMockCompiledGraph();
      const updatedEntity = createMockGraphEntity({
        status: GraphStatus.Stopped,
      });
      const updatedGraph = createMockGraphDto({
        status: GraphStatus.Stopped,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      vi.mocked(graphDao.updateById).mockResolvedValue(updatedEntity);

      const result = await service.destroy(mockCtx, mockGraphId);

      expect(result).toMatchObject(updatedGraph);
      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraphId, {
        status: GraphStatus.Stopped,
        error: null,
      });
      expect(notificationsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: GraphStatus.Stopped }),
        }),
      );
    });

    it('should handle destroying non-running graph', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const updatedEntity = createMockGraphEntity({
        status: GraphStatus.Stopped,
      });
      const updatedGraph = createMockGraphDto({
        status: GraphStatus.Stopped,
      });

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.updateById).mockResolvedValue(updatedEntity);

      const result = await service.destroy(mockCtx, mockGraphId);

      expect(result).toMatchObject(updatedGraph);
      expect(graphRegistry.destroy).not.toHaveBeenCalled();
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraphId, {
        status: GraphStatus.Stopped,
        error: null,
      });
      expect(notificationsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: GraphStatus.Stopped }),
        }),
      );
    });

    it('should throw NotFoundException when graph not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(service.destroy(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when database update fails', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Running });
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      vi.mocked(graphDao.updateById).mockResolvedValue(null);

      await expect(service.destroy(mockCtx, mockGraphId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('executeTrigger', () => {
    it('should execute trigger in async mode, pass flag, and return thread info', async () => {
      const triggerId = 'trigger-1';
      const agentId = 'agent-1';
      const customThreadId = 'async-thread';
      const expectedThreadId = `${mockGraphId}:${customThreadId}`;

      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Running,
        schema: {
          nodes: [
            {
              id: triggerId,
              template: 'manual-trigger',
              config: { agentId },
            },
          ],
          edges: [],
        },
      });

      const mockTrigger = {
        isStarted: true,
        invokeAgent: vi.fn().mockResolvedValue({
          messages: [],
          threadId: expectedThreadId,
          checkpointNs: `${expectedThreadId}:${agentId}`,
        }),
      };
      const mockTriggerNode = {
        id: triggerId,
        type: NodeKind.Trigger,
        template: 'manual-trigger',
        instance: mockTrigger,
        handle: {
          provide: async () => mockTrigger,
          configure: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        },
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };
      const mockCompiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockTriggerNode as unknown as CompiledGraphNode,
      );

      const result = await service.executeTrigger(
        mockCtx,
        mockGraphId,
        triggerId,
        {
          messages: ['Async test message'],
          threadSubId: customThreadId,
          async: true,
        },
      );

      expect(result).toEqual({
        externalThreadId: expectedThreadId,
        checkpointNs: `${expectedThreadId}:${agentId}`,
      });

      // Ensure invokeAgent was called with provided threadSubId
      expect(mockTrigger.invokeAgent).toHaveBeenCalledWith(
        [expect.objectContaining({ content: 'Async test message' })],
        { configurable: { thread_id: customThreadId, async: true } },
      );
    });

    it('should execute trigger in async mode with auto-generated threadId when threadSubId not provided', async () => {
      const triggerId = 'trigger-1';
      const agentId = 'agent-1';
      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Running,
        schema: {
          nodes: [
            {
              id: triggerId,
              template: 'manual-trigger',
              config: { agentId },
            },
          ],
          edges: [],
        },
      });

      const mockTrigger = {
        isStarted: true,
        invokeAgent: vi.fn().mockResolvedValue({
          messages: [],
          threadId: `${mockGraphId}:generated-uuid`,
          checkpointNs: `${mockGraphId}:generated-uuid:${agentId}`,
        }),
      };
      const mockTriggerNode = {
        id: triggerId,
        type: NodeKind.Trigger,
        template: 'manual-trigger',
        instance: mockTrigger,
        handle: {
          provide: async () => mockTrigger,
          configure: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        },
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };
      const mockCompiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockTriggerNode as unknown as CompiledGraphNode,
      );

      const result = await service.executeTrigger(
        mockCtx,
        mockGraphId,
        triggerId,
        {
          messages: ['Async test message'],
          async: true,
        },
      );

      expect(result.externalThreadId).toMatch(new RegExp(`^${mockGraphId}:`));
      expect(result).toHaveProperty('checkpointNs');

      expect(mockTrigger.invokeAgent).toHaveBeenCalledWith(
        [expect.objectContaining({ content: 'Async test message' })],
        { configurable: { thread_id: undefined, async: true } },
      );
    });
    it('should execute trigger with custom threadId and return thread info', async () => {
      const triggerId = 'trigger-1';
      const agentId = 'agent-1';
      const customThreadId = 'my-thread';
      const expectedThreadId = `${mockGraphId}:${customThreadId}`;
      const expectedCheckpointNs = `${expectedThreadId}:${agentId}`;

      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Running,
        schema: {
          nodes: [
            {
              id: triggerId,
              template: 'manual-trigger',
              config: { agentId },
            },
          ],
          edges: [],
        },
      });
      const mockTrigger = {
        isStarted: true,
        invokeAgent: vi.fn().mockResolvedValue({
          messages: [],
          threadId: expectedThreadId,
          checkpointNs: expectedCheckpointNs,
        }),
      };
      const mockTriggerNode = {
        id: triggerId,
        type: NodeKind.Trigger,
        template: 'manual-trigger',
        instance: mockTrigger,
        handle: {
          provide: async () => mockTrigger,
          configure: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        },
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };
      const mockCompiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockTriggerNode as unknown as CompiledGraphNode,
      );

      const result = await service.executeTrigger(
        mockCtx,
        mockGraphId,
        triggerId,
        {
          messages: ['Test message'],
          threadSubId: customThreadId,
        },
      );

      expect(result).toEqual({
        externalThreadId: expectedThreadId,
        checkpointNs: expectedCheckpointNs,
      });

      expect(mockTrigger.invokeAgent).toHaveBeenCalledWith(
        [expect.objectContaining({ content: 'Test message' })],
        {
          configurable: {
            thread_id: customThreadId,
          },
        },
      );
    });

    it('should execute trigger with auto-generated threadId (UUID) and return thread info', async () => {
      const triggerId = 'trigger-1';
      const agentId = 'agent-1';
      const mockGraph = createMockGraphEntity({
        status: GraphStatus.Running,
        schema: {
          nodes: [
            {
              id: triggerId,
              template: 'manual-trigger',
              config: { agentId },
            },
          ],
          edges: [],
        },
      });
      // Mock with dynamic return value
      const mockTrigger = {
        isStarted: true,
        invokeAgent: vi.fn().mockImplementation((messages, config) => {
          // Generate threadId based on what's passed
          const threadIdFromConfig = config?.configurable?.thread_id;
          const fullThreadId = `${mockGraphId}:${threadIdFromConfig || 'generated-uuid'}`;
          const checkpointNs = `${fullThreadId}:${agentId}`;
          return Promise.resolve({
            messages: [],
            threadId: fullThreadId,
            checkpointNs,
          });
        }),
      };
      const mockTriggerNode = {
        id: triggerId,
        type: NodeKind.Trigger,
        template: 'manual-trigger',
        instance: mockTrigger,
        handle: {
          provide: async () => mockTrigger,
          configure: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        },
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };
      const mockCompiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockTriggerNode as unknown as CompiledGraphNode,
      );

      const result = await service.executeTrigger(
        mockCtx,
        mockGraphId,
        triggerId,
        {
          messages: ['Test message'],
        },
      );

      // Verify externalThreadId format is graphId:generated or similar
      expect(result.externalThreadId).toMatch(new RegExp(`^${mockGraphId}:`));
      // Verify checkpointNs format includes agentId
      expect(result.checkpointNs).toContain(agentId);

      expect(mockTrigger.invokeAgent).toHaveBeenCalledWith(
        [expect.objectContaining({ content: 'Test message' })],
        {
          configurable: {
            thread_id: undefined, // No threadId provided
          },
        },
      );
    });

    it('should throw NotFoundException when graph not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(
        service.executeTrigger(mockCtx, mockGraphId, 'trigger-1', {
          messages: ['Test'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when graph is not running', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Created });
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);

      await expect(
        service.executeTrigger(mockCtx, mockGraphId, 'trigger-1', {
          messages: ['Test'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when trigger not found', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      const mockCompiledGraph = createMockCompiledGraph();
      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(undefined);

      await expect(
        service.executeTrigger(mockCtx, mockGraphId, 'trigger-1', {
          messages: ['Test'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when node is not a trigger', async () => {
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      const mockCompiledGraph = createMockCompiledGraph();
      const mockNode = {
        id: 'node-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {},
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockNode as unknown as CompiledGraphNode,
      );

      await expect(
        service.executeTrigger(mockCtx, mockGraphId, 'node-1', {
          messages: ['Test'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when trigger is not started', async () => {
      const triggerId = 'trigger-1';
      const mockGraph = createMockGraphEntity({ status: GraphStatus.Running });
      const mockTrigger = {
        isStarted: false,
        invokeAgent: vi.fn(),
      };
      const mockTriggerNode = {
        id: triggerId,
        type: NodeKind.Trigger,
        template: 'manual-trigger',
        instance: mockTrigger,
        handle: {
          provide: async () => mockTrigger,
          configure: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        },
        getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
      };
      const mockCompiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
      vi.mocked(graphRegistry.getNode).mockReturnValue(
        mockTriggerNode as unknown as CompiledGraphNode,
      );

      await expect(
        service.executeTrigger(mockCtx, mockGraphId, triggerId, {
          messages: ['Test'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('eager thread creation', () => {
      const triggerId = 'trigger-1';
      const expectedThreadId = `${mockGraphId}:my-thread`;

      const setupTriggerMocks = () => {
        const mockTrigger = {
          isStarted: true,
          invokeAgent: vi.fn().mockResolvedValue({
            messages: [],
            threadId: expectedThreadId,
            checkpointNs: `${expectedThreadId}:agent-1`,
          }),
        };
        const mockTriggerNode = {
          id: triggerId,
          type: NodeKind.Trigger,
          template: 'manual-trigger',
          instance: mockTrigger,
          handle: {
            provide: async () => mockTrigger,
            configure: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockResolvedValue(undefined),
          },
          getStatus: vi.fn().mockReturnValue(GraphNodeStatus.Idle),
        };
        const mockGraph = createMockGraphEntity({
          status: GraphStatus.Running,
        });
        const mockCompiledGraph = createMockCompiledGraph();

        vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
        vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);
        vi.mocked(graphRegistry.getNode).mockReturnValue(
          mockTriggerNode as unknown as CompiledGraphNode,
        );

        return mockTrigger;
      };

      it('should eagerly create thread when it does not exist', async () => {
        setupTriggerMocks();
        vi.mocked(threadsDao.getOne).mockResolvedValue(null);
        vi.mocked(threadsDao.create).mockResolvedValue({
          id: 'thread-uuid',
          graphId: mockGraphId,
          externalThreadId: expectedThreadId,
          createdBy: mockUserId,
          status: ThreadStatus.Running,
        } as any);

        const result = await service.executeTrigger(
          mockCtx,
          mockGraphId,
          triggerId,
          {
            messages: ['Hello'],
            threadSubId: 'my-thread',
            metadata: { key: 'value' },
          },
        );

        expect(result.externalThreadId).toBe(expectedThreadId);
        expect(threadsDao.getOne).toHaveBeenCalledWith({
          externalThreadId: expectedThreadId,
          graphId: mockGraphId,
        });
        expect(threadsDao.create).toHaveBeenCalledWith({
          graphId: mockGraphId,
          createdBy: mockUserId,
          externalThreadId: expectedThreadId,
          status: ThreadStatus.Running,
          metadata: { key: 'value' },
        });
      });

      it('should skip creation when thread already exists', async () => {
        setupTriggerMocks();
        vi.mocked(threadsDao.getOne).mockResolvedValue({
          id: 'existing-thread',
          graphId: mockGraphId,
          externalThreadId: expectedThreadId,
          createdBy: mockUserId,
          status: ThreadStatus.Running,
        } as any);

        const result = await service.executeTrigger(
          mockCtx,
          mockGraphId,
          triggerId,
          {
            messages: ['Hello'],
            threadSubId: 'my-thread',
          },
        );

        expect(result.externalThreadId).toBe(expectedThreadId);
        expect(threadsDao.getOne).toHaveBeenCalledWith({
          externalThreadId: expectedThreadId,
          graphId: mockGraphId,
        });
        expect(threadsDao.create).not.toHaveBeenCalled();
      });

      it('should swallow unique constraint error when handler wins the race', async () => {
        setupTriggerMocks();
        vi.mocked(threadsDao.getOne).mockResolvedValue(null);
        const uniqueViolation = Object.assign(
          new Error('duplicate key value violates unique constraint'),
          { code: '23505' },
        );
        vi.mocked(threadsDao.create).mockRejectedValue(uniqueViolation);

        const result = await service.executeTrigger(
          mockCtx,
          mockGraphId,
          triggerId,
          {
            messages: ['Hello'],
            threadSubId: 'my-thread',
          },
        );

        expect(result.externalThreadId).toBe(expectedThreadId);
        expect(threadsDao.create).toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Eager thread creation skipped'),
        );
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete graph lifecycle', async () => {
      const createData: CreateGraphDto = {
        name: 'Lifecycle Graph',
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [],
        },
        metadata: {
          graphId: 'lifecycle-graph',
          version: '1.0.0',
        },
      };

      const createdGraph = createMockGraphEntity({
        id: 'lifecycle-graph',
        name: 'Lifecycle Graph',
        status: GraphStatus.Created,
      });
      const runningGraph = createMockGraphEntity({
        id: 'lifecycle-graph',
        status: GraphStatus.Running,
      });
      const stoppedGraph = createMockGraphEntity({
        id: 'lifecycle-graph',
        status: GraphStatus.Stopped,
      });
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphDao.create).mockResolvedValue(createdGraph);
      const created = await service.create(mockCtx, createData);
      expect(created.status).toBe(GraphStatus.Created);

      vi.mocked(graphDao.getOne).mockResolvedValue(createdGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(
          createMockGraphEntity({
            id: 'lifecycle-graph',
            status: GraphStatus.Compiling,
          }),
        )
        .mockResolvedValueOnce(runningGraph)
        .mockResolvedValueOnce(stoppedGraph);
      const running = await service.run(mockCtx, 'lifecycle-graph');
      expect(running.status).toBe(GraphStatus.Running);

      // Destroy
      vi.mocked(graphDao.getOne).mockResolvedValue(runningGraph);
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      const stopped = await service.destroy(mockCtx, 'lifecycle-graph');
      expect(stopped.status).toBe(GraphStatus.Stopped);

      vi.mocked(graphDao.getOne).mockResolvedValue(stoppedGraph);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      await service.delete(mockCtx, 'lifecycle-graph');
    });

    it('should handle error recovery scenarios', async () => {
      const graph = createMockGraphEntity({ status: GraphStatus.Created });
      const compiledGraph = createMockCompiledGraph();

      // Simulate compilation error with registry cleanup
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);
      vi.mocked(graphCompiler.compile).mockRejectedValue(
        new Error('Compilation failed'),
      );
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);
      vi.mocked(graphDao.updateById)
        .mockResolvedValueOnce(
          createMockGraphEntity({ status: GraphStatus.Compiling }),
        )
        .mockResolvedValueOnce(
          createMockGraphEntity({
            status: GraphStatus.Error,
            error: 'Compilation failed',
          }),
        );

      await expect(service.run(mockCtx, mockGraphId)).rejects.toThrow(
        'Compilation failed',
      );

      // Verify cleanup happened
      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
      expect(graphDao.updateById).toHaveBeenNthCalledWith(
        2,
        mockGraphId,
        expect.objectContaining({
          status: GraphStatus.Error,
          error: 'Compilation failed',
        }),
      );
    });
  });
  describe('compileTemporary', () => {
    it('returns existing compiled graph when graph is already running', async () => {
      const compiledGraph = createMockCompiledGraph();
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);

      const result = await service.compileTemporary(mockGraphId, mockUserId);

      expect(result.compiledGraph).toBe(compiledGraph);
      expect(result.wasAlreadyRunning).toBe(true);
      expect(graphDao.getOne).not.toHaveBeenCalled();
      expect(graphCompiler.compile).not.toHaveBeenCalled();
    });

    it('compiles graph temporarily when not running and sets temporary=true', async () => {
      const graph = createMockGraphEntity({ temporary: false });
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);

      const result = await service.compileTemporary(mockGraphId, mockUserId);

      expect(result.compiledGraph).toBe(compiledGraph);
      expect(result.wasAlreadyRunning).toBe(false);
      expect(graphCompiler.compile).toHaveBeenCalledWith(
        expect.objectContaining({ temporary: true }),
        { graphId: graph.id, name: graph.name, version: graph.version },
      );
      // DB status must NOT be updated
      expect(graphDao.updateById).not.toHaveBeenCalled();
      // Notifications must NOT be emitted
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when graph does not exist', async () => {
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      await expect(
        service.compileTemporary('nonexistent-id', mockUserId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not write DB status changes during temporary compilation', async () => {
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);

      await service.compileTemporary(mockGraphId, mockUserId);

      expect(graphDao.updateById).not.toHaveBeenCalled();
    });

    it('sets wasAlreadyRunning=true when graph is registered concurrently between DB load and compile', async () => {
      // Simulates TOCTOU: graphRegistry.get returns undefined on first call
      // (before DB load), but returns a compiled graph on second call (before compile),
      // as if run() was called concurrently while we were querying the DB.
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined) // first check: not running yet
        .mockReturnValueOnce(compiledGraph); // second check (before compile): now running

      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);

      const result = await service.compileTemporary(mockGraphId, mockUserId);

      // wasAlreadyRunning must be true because the graph was registered
      // between the two registry checks — the finalizer must not destroy it
      expect(result.wasAlreadyRunning).toBe(true);
    });

    it('serializes concurrent compilation — second call awaits the first', async () => {
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);

      // graphCompiler.compile resolves after a tick to simulate async work
      let resolveCompile!: (g: CompiledGraph) => void;
      const compilePromise = new Promise<CompiledGraph>((res) => {
        resolveCompile = res;
      });
      vi.mocked(graphCompiler.compile).mockReturnValueOnce(compilePromise);

      // After the first compile promise is created, wire up the second call
      // to also return the same promise (simulating getOrCompile in-flight dedup)
      vi.mocked(graphCompiler.compile).mockReturnValue(compilePromise);

      // Both concurrent calls: kick off first, then resolve and start second
      const p1 = service.compileTemporary(mockGraphId, mockUserId);
      resolveCompile(compiledGraph);
      const p2 = service.compileTemporary(mockGraphId, mockUserId);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.compiledGraph).toBe(compiledGraph);
      expect(r2.compiledGraph).toBe(compiledGraph);
    });
  });

  describe('runForSuggestions', () => {
    it('destroys graph after callback when graph was not already running', async () => {
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);

      const callback = vi.fn().mockResolvedValue('result');

      const result = await service.runForSuggestions(
        mockGraphId,
        mockUserId,
        callback,
      );

      expect(result).toBe('result');
      expect(callback).toHaveBeenCalledWith(compiledGraph);
      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
    });

    it('does NOT destroy graph when it was already running before the call', async () => {
      const compiledGraph = createMockCompiledGraph();

      // Graph is already running
      vi.mocked(graphRegistry.get).mockReturnValue(compiledGraph);

      const callback = vi.fn().mockResolvedValue('result');

      await service.runForSuggestions(mockGraphId, mockUserId, callback);

      expect(callback).toHaveBeenCalledWith(compiledGraph);
      expect(graphRegistry.destroy).not.toHaveBeenCalled();
    });

    it('destroys graph in finally block even when callback throws', async () => {
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockResolvedValue(undefined);

      const callback = vi.fn().mockRejectedValue(new Error('Callback error'));

      await expect(
        service.runForSuggestions(mockGraphId, mockUserId, callback),
      ).rejects.toThrow('Callback error');

      // Graph must be cleaned up even on error
      expect(graphRegistry.destroy).toHaveBeenCalledWith(mockGraphId);
    });

    it('propagates NotFoundException when graph not found during compile', async () => {
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      const callback = vi.fn();

      await expect(
        service.runForSuggestions(mockGraphId, mockUserId, callback),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(callback).not.toHaveBeenCalled();
    });

    it('swallows destroy errors and logs them so callback error is not masked', async () => {
      const graph = createMockGraphEntity();
      const compiledGraph = createMockCompiledGraph();

      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphDao.getOne).mockResolvedValue(graph);
      vi.mocked(graphCompiler.compile).mockResolvedValue(compiledGraph);
      vi.mocked(graphRegistry.destroy).mockRejectedValue(
        new Error('Registry error'),
      );

      const callbackError = new Error('Callback error');
      const callback = vi.fn().mockRejectedValue(callbackError);

      // The callback error must propagate, not the destroy error
      await expect(
        service.runForSuggestions(mockGraphId, mockUserId, callback),
      ).rejects.toThrow('Callback error');

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
