import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRestorationService } from './graph-restoration.service';
import { GraphsService } from './graphs.service';

// Mock DockerRuntime static method
vi.mock('../../runtime/services/docker-runtime', () => ({
  DockerRuntime: {
    cleanupByLabels: vi.fn(),
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
  let moduleRef: any;
  let logger: any;

  const mockGraph: GraphEntity = {
    id: 'test-graph-id',
    name: 'Test Graph',
    description: 'Test Description',
    version: '1.0.0',
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
      getRunningGraphs: vi.fn(),
      getTemporaryGraphs: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    };

    const mockGraphCompiler = {
      compile: vi.fn(),
      destroyNotCompiledGraph: vi.fn(),
    };

    const mockGraphRegistry = {
      get: vi.fn(),
      register: vi.fn(),
    };

    const mockThreadsDao = {
      getAll: vi.fn(),
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
    moduleRef = module.get(ModuleRef);
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
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
    });

    it('should handle no running graphs', async () => {
      // Arrange
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([]);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).not.toHaveBeenCalled();
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle run errors gracefully', async () => {
      // Arrange
      const compilationError = new Error('Compilation failed');
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphsService.run).mockRejectedValue(compilationError);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
    });

    it('should skip already registered graphs', async () => {
      // Arrange
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      vi.mocked(graphRegistry.get).mockReturnValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
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

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([
        mockGraph,
        mockGraph2,
      ]);
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

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph.id);
      expect(graphsService.run).toHaveBeenCalledWith(mockGraph2.id);
    });

    it('should destroy temporary graphs using destroyNotCompiledGraph', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([
        temporaryGraph,
      ]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockResolvedValue(
        undefined,
      );

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle destroyNotCompiledGraph errors gracefully', async () => {
      // Arrange
      const temporaryGraph: GraphEntity = {
        ...mockGraph,
        id: 'temporary-graph-id',
        name: 'Temporary Graph',
        temporary: true,
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([
        temporaryGraph,
      ]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockRejectedValue(
        new Error('Destroy failed'),
      );

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
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
      };
      const permanentGraph: GraphEntity = {
        ...mockGraph,
        id: 'permanent-graph-id',
        name: 'Permanent Graph',
        temporary: false,
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([
        temporaryGraph,
      ]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([permanentGraph]);
      vi.mocked(graphDao.deleteById).mockResolvedValue(undefined);
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraph);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockResolvedValue(
        undefined,
      );
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: permanentGraph.id,
        status: GraphStatus.Running,
      } as any);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      // Temporary graph should be destroyed using destroyNotCompiledGraph
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
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
      };
      const deletionError = new Error('Deletion failed');

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([
        temporaryGraph,
      ]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([]);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockResolvedValue(
        undefined,
      );
      vi.mocked(graphDao.deleteById).mockRejectedValue(deletionError);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
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
      };
      const cleanupError = new Error('Container cleanup failed');

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([
        temporaryGraph,
      ]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([]);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockRejectedValue(
        cleanupError,
      );

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
    });

    it('should resume interrupted threads after restoring a graph', async () => {
      // Arrange
      const mockAgent = {
        run: vi.fn().mockResolvedValue({
          messages: [],
          threadId: 'test-graph-id:thread-1',
        }),
      };

      const mockAgentNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'You are a helpful test agent.',
            invokeModelName: 'gpt-5-mini',
          },
        },
        config: {},
      };

      const mockCompiledGraphWithAgent = {
        nodes: new Map([['agent-1', mockAgentNode]]),
        edges: [],
        state: {
          getSnapshots: vi.fn(),
        },
        destroy: vi.fn(),
      };

      const mockThread = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      const registryGetMock = vi.mocked(graphRegistry.get);
      let firstCall = true;
      registryGetMock.mockImplementation((graphId: string) => {
        if (graphId === mockGraph.id) {
          if (firstCall) {
            firstCall = false;
            return undefined;
          }
          return mockCompiledGraphWithAgent;
        }
        return undefined;
      });
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([mockThread]);
      vi.mocked(graphCheckpointsDao.getAll).mockResolvedValue([
        {
          checkpointNs: '',
          checkpointId: 'chk-empty',
        } as any,
        {
          checkpointNs: `${mockThread.externalThreadId}:agent-1`,
          checkpointId: 'chk-123',
        } as any,
      ]);

      // Act
      await service.restoreRunningGraphs();

      // Give some time for async thread resumption to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        graphId: 'test-graph-id',
        status: ThreadStatus.Running,
      });
      expect(graphCheckpointsDao.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: mockThread.externalThreadId,
          order: { createdAt: 'DESC' },
          limit: 20,
        }),
      );
      expect(mockAgent.run).toHaveBeenCalledWith(
        'test-graph-id:thread-1',
        [],
        mockAgentNode.instance.config,
        {
          configurable: expect.objectContaining({
            graph_id: 'test-graph-id',
            node_id: 'agent-1',
            parent_thread_id: 'test-graph-id:thread-1',
            thread_id: 'test-graph-id:thread-1',
            source: 'graph-restoration',
            checkpoint_ns: `${mockThread.externalThreadId}:agent-1`,
            checkpoint_id: 'chk-123',
            async: true,
          }),
        },
      );
    });

    it('should handle no interrupted threads gracefully', async () => {
      // Arrange
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
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
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        graphId: 'test-graph-id',
        status: ThreadStatus.Running,
      });
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('No interrupted threads'),
      );
    });

    it('should extract node ID from thread ID with node suffix', async () => {
      // Arrange
      const mockAgent = {
        run: vi.fn().mockResolvedValue({
          messages: [],
          threadId: 'test-graph-id:thread-1__agent-1',
        }),
      };

      const mockAgentNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'You are a helpful test agent.',
            invokeModelName: 'gpt-5-mini',
          },
        },
        config: {},
      };

      const mockCompiledGraphWithAgent = {
        nodes: new Map([['agent-1', mockAgentNode]]),
        edges: [],
        state: {
          getSnapshots: vi.fn(),
        },
        destroy: vi.fn(),
      };

      const mockThread = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1__agent-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      const registryGetMockNodeSuffix = vi.mocked(graphRegistry.get);
      let firstCallNodeSuffix = true;
      registryGetMockNodeSuffix.mockImplementation((graphId: string) => {
        if (graphId === mockGraph.id) {
          if (firstCallNodeSuffix) {
            firstCallNodeSuffix = false;
            return undefined;
          }
          return mockCompiledGraphWithAgent;
        }
        return undefined;
      });
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([mockThread]);
      vi.mocked(graphCheckpointsDao.getAll).mockResolvedValue([
        {
          checkpointNs: '',
          checkpointId: 'chk-empty',
        } as any,
        {
          checkpointNs: `${mockThread.externalThreadId}:agent-1`,
          checkpointId: 'chk-456',
        } as any,
      ]);

      // Act
      await service.restoreRunningGraphs();

      // Give some time for async thread resumption to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(mockAgent.run).toHaveBeenCalledWith(
        'test-graph-id:thread-1__agent-1',
        [],
        mockAgentNode.instance.config,
        {
          configurable: expect.objectContaining({
            node_id: 'agent-1',
            checkpoint_ns: `${mockThread.externalThreadId}:agent-1`,
            checkpoint_id: 'chk-456',
            async: true,
          }),
        },
      );
    });

    it('should handle thread resumption errors gracefully', async () => {
      // Arrange
      const mockAgent = {
        run: vi.fn().mockRejectedValue(new Error('Resume failed')),
      };

      const mockAgentNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'You are a helpful test agent.',
            invokeModelName: 'gpt-5-mini',
          },
        },
        config: {},
      };

      const mockCompiledGraphWithAgent = {
        nodes: new Map([['agent-1', mockAgentNode]]),
        edges: [],
        state: {
          getSnapshots: vi.fn(),
        },
        destroy: vi.fn(),
      };

      const mockThread = {
        id: 'thread-uuid-1',
        graphId: 'test-graph-id',
        externalThreadId: 'test-graph-id:thread-1',
        createdBy: 'test-user',
        status: ThreadStatus.Running,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      const registryGetMockError = vi.mocked(graphRegistry.get);
      let firstCallError = true;
      registryGetMockError.mockImplementation((graphId: string) => {
        if (graphId === mockGraph.id) {
          if (firstCallError) {
            firstCallError = false;
            return undefined;
          }
          return mockCompiledGraphWithAgent;
        }
        return undefined;
      });
      vi.mocked(graphsService.run).mockResolvedValueOnce({
        id: mockGraph.id,
        status: GraphStatus.Running,
      } as any);
      vi.mocked(threadsDao.getAll).mockResolvedValue([mockThread]);
      vi.mocked(graphCheckpointsDao.getAll).mockResolvedValue([
        {
          checkpointNs: '',
          checkpointId: 'chk-empty',
        } as any,
        {
          checkpointNs: `${mockThread.externalThreadId}:agent-1`,
          checkpointId: 'chk-999',
        } as any,
      ]);

      // Act
      await service.restoreRunningGraphs();

      // Give some time for async thread resumption to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert - should not throw, but log error
      expect(mockAgent.run).toHaveBeenCalled();
    });
  });
});
