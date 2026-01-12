import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRestorationService } from './graph-restoration.service';

// Mock DockerRuntime static method
vi.mock('../../runtime/services/docker-runtime', () => ({
  DockerRuntime: {
    cleanupByLabels: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('GraphRestorationService', () => {
  let service: GraphRestorationService;
  let graphDao: any;
  let graphCompiler: any;
  let graphRegistry: any;
  let threadsDao: any;
  let graphCheckpointsDao: any;
  let graphsService: any;
  let logger: any;

  const mockGraphDaoLists = (
    temporaryGraphs: GraphEntity[] = [],
    statusGraphs: GraphEntity[] = [],
  ) => {
    vi.mocked(graphDao.getAll)
      .mockResolvedValueOnce(temporaryGraphs)
      .mockResolvedValueOnce(statusGraphs);
  };

  const mockGraph: GraphEntity = {
    id: 'test-graph-id',
    name: 'Test Graph',
    description: 'Test Description',
    version: '1.0.0',
    targetVersion: '1.0.0',
    schema: {
      nodes: [
        {
          id: 'agent-1',
          template: 'simple-agent',
          config: {
            name: 'Test Agent',
            instructions: 'You are a helpful test agent.',
            invokeModelName: 'gpt-5-mini',
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
    status: GraphStatus.Running,
    createdBy: 'test-user',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    temporary: false,
  };

  const mockCompiledGraph = {
    nodes: new Map(),
    edges: [],
    destroy: vi.fn(),
  };

  beforeEach(async () => {
    const mockGraphDao = {
      getAll: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    };

    const mockGraphCompiler = {
      compile: vi.fn(),
    };

    const mockGraphRegistry = {
      get: vi.fn(),
      register: vi.fn(),
      getNodeInstance: vi.fn(),
    };

    const mockThreadsDao = {
      getAll: vi.fn(),
      updateById: vi.fn(),
    };

    const mockGraphCheckpointsDao = {
      getAll: vi.fn(),
    };

    const mockLogger = {
      log: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const mockGraphsService = {
      run: vi.fn(),
    };

    const mockModuleRef = {
      create: vi.fn().mockResolvedValue(mockGraphsService),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphRestorationService,
        {
          provide: GraphDao,
          useValue: mockGraphDao,
        },
        {
          provide: GraphCompiler,
          useValue: mockGraphCompiler,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
        },
        {
          provide: ThreadsDao,
          useValue: mockThreadsDao,
        },
        {
          provide: GraphCheckpointsDao,
          useValue: mockGraphCheckpointsDao,
        },
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
        },
        {
          provide: DefaultLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GraphRestorationService>(GraphRestorationService);
    graphDao = module.get(GraphDao);
    graphCompiler = module.get(GraphCompiler);
    graphRegistry = module.get(GraphRegistry);
    threadsDao = module.get(ThreadsDao);
    graphCheckpointsDao = module.get(GraphCheckpointsDao);
    graphsService = mockGraphsService;
    logger = module.get(DefaultLogger);

    vi.mocked(graphCheckpointsDao.getAll).mockResolvedValue([]);
    vi.mocked(graphsService.run).mockReset();
    vi.mocked(graphsService.run).mockResolvedValue({
      id: mockGraph.id,
      status: GraphStatus.Running,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('restoreRunningGraphs', () => {
    it('should restore running graphs successfully', async () => {
      // Arrange
      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
    });

    it('should handle no running graphs', async () => {
      // Arrange
      mockGraphDaoLists([], []);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(graphCompiler.compile).not.toHaveBeenCalled();
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle run errors gracefully', async () => {
      // Arrange
      const compilationError = new Error('Compilation failed');
      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphsService.run).mockRejectedValue(compilationError);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
    });

    it('should skip already registered graphs', async () => {
      // Arrange
      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(graphCompiler.compile).not.toHaveBeenCalled();
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle multiple graphs with mixed results', async () => {
      // Arrange
      const mockGraph2 = {
        ...mockGraph,
        id: 'test-graph-id-2',
        name: 'Test Graph 2',
      };
      const compilationError = new Error('Compilation failed');

      vi.mocked(graphDao.getAll)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockGraph, mockGraph2]);
      const registryGetMock = vi.mocked(graphRegistry.get);
      let firstGraphFirstCall = true;
      registryGetMock.mockImplementation((graphId: string) => {
        if (graphId === mockGraph.id) {
          if (firstGraphFirstCall) {
            firstGraphFirstCall = false;
            return undefined;
          }
          return mockCompiledGraph;
        }
        return undefined;
      });
      vi.mocked(graphsService.run)
        .mockResolvedValueOnce({
          id: mockGraph.id,
          status: GraphStatus.Running,
        } as any)
        .mockRejectedValueOnce(compilationError);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph2.id);
    });

    it('should destroy temporary graphs and cleanup Docker containers', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {},
            },
          ],
          edges: [],
        },
      };

      vi.mocked(graphDao.getAll)
        .mockResolvedValueOnce([temporaryGraph])
        .mockResolvedValueOnce([]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(DockerRuntime.cleanupByLabels).toHaveBeenCalledWith({
        'ai-company/graph_id': temporaryGraph.id,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle Docker cleanup errors gracefully', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {},
            },
          ],
          edges: [],
        },
      };

      vi.mocked(graphDao.getAll)
        .mockResolvedValueOnce([temporaryGraph])
        .mockResolvedValueOnce([]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      vi.mocked(DockerRuntime.cleanupByLabels).mockRejectedValueOnce(
        new Error('Destroy failed'),
      );

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(DockerRuntime.cleanupByLabels).toHaveBeenCalledWith({
        'ai-company/graph_id': temporaryGraph.id,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle mixed temporary and permanent graphs', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {},
            },
          ],
          edges: [],
        },
      };
      const permanentGraph: GraphEntity = {
        ...mockGraph,
        id: 'permanent-graph-id',
        name: 'Permanent Graph',
        temporary: false,
      };

      vi.mocked(graphDao.getAll)
        .mockResolvedValueOnce([temporaryGraph])
        .mockResolvedValueOnce([permanentGraph]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: permanentGraph.id,
        status: GraphStatus.Running,
      } as any);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      // Temporary graph should be destroyed
      expect(DockerRuntime.cleanupByLabels).toHaveBeenCalledWith({
        'ai-company/graph_id': temporaryGraph.id,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      // Then permanent graph should be started via graphs service
      expect(graphsService.run).toHaveBeenCalledWith(permanentGraph.id);
    });

    it('should handle errors when deleting temporary graphs', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {},
            },
          ],
          edges: [],
        },
      };
      const deletionError = new Error('Deletion failed');

      mockGraphDaoLists([temporaryGraph], []);
      vi.mocked(graphDao.deleteById).mockRejectedValue(deletionError);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(DockerRuntime.cleanupByLabels).toHaveBeenCalledWith({
        'ai-company/graph_id': temporaryGraph.id,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should cleanup runtime containers even if container cleanup fails', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {},
            },
          ],
          edges: [],
        },
      };
      const cleanupError = new Error('Container cleanup failed');

      mockGraphDaoLists([temporaryGraph], []);
      vi.mocked(DockerRuntime.cleanupByLabels).mockRejectedValueOnce(
        cleanupError,
      );

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(DockerRuntime.cleanupByLabels).toHaveBeenCalledWith({
        'ai-company/graph_id': temporaryGraph.id,
      });
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
    });

    it('should stop interrupted threads after restoring a graph', async () => {
      // Arrange
      const mockThread = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([mockThread]);
      vi.mocked(threadsDao.updateById).mockResolvedValue(mockThread as any);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        graphId: 'test-graph-id',
        status: ThreadStatus.Running,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith('thread-uuid-1', {
        status: ThreadStatus.Stopped,
      });
    });

    it('should handle no interrupted threads gracefully', async () => {
      // Arrange
      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([]);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getAll).toHaveBeenCalledTimes(2);
      expect(graphDao.getAll).toHaveBeenNthCalledWith(1, { temporary: true });
      expect(graphDao.getAll).toHaveBeenNthCalledWith(2, {
        statuses: [GraphStatus.Running, GraphStatus.Compiling],
      });
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        graphId: 'test-graph-id',
        status: ThreadStatus.Running,
      });
      expect(threadsDao.updateById).not.toHaveBeenCalled();
    });

    it('should stop multiple interrupted threads', async () => {
      // Arrange
      const mockThread1 = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockThread2 = {
        id: 'thread-uuid-2',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-2',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([
        mockThread1,
        mockThread2,
      ]);
      vi.mocked(threadsDao.updateById).mockResolvedValue(mockThread1 as any);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(threadsDao.updateById).toHaveBeenCalledTimes(2);
      expect(threadsDao.updateById).toHaveBeenCalledWith('thread-uuid-1', {
        status: ThreadStatus.Stopped,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith('thread-uuid-2', {
        status: ThreadStatus.Stopped,
      });
    });

    it('should handle thread stopping errors gracefully', async () => {
      // Arrange
      const mockThread = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGraphDaoLists([], [mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([mockThread]);
      vi.mocked(threadsDao.updateById).mockRejectedValue(
        new Error('Database error'),
      );

      // Act & Assert - should not throw, but handle error gracefully
      await expect(service.restoreRunningGraphs()).resolves.not.toThrow();
      expect(threadsDao.updateById).toHaveBeenCalledWith('thread-uuid-1', {
        status: ThreadStatus.Stopped,
      });
    });
  });
});
