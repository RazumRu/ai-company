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
    logger = module.get(DefaultLogger);

    vi.mocked(graphCheckpointsDao.getAll).mockResolvedValue([]);
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
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockResolvedValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledWith(mockGraph);
      expect(graphRegistry.register).toHaveBeenCalledWith(
        mockGraph.id,
        mockCompiledGraph,
      );
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

    it('should handle compilation errors and update graph status', async () => {
      // Arrange
      const compilationError = new Error('Compilation failed');
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getTemporaryGraphs).mockResolvedValue([]);
      vi.mocked(graphDao.getRunningGraphs).mockResolvedValue([mockGraph]);
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockRejectedValue(compilationError);
      vi.mocked(graphDao.updateById).mockResolvedValue(mockGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledWith(mockGraph);
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraph.id, {
        status: GraphStatus.Error,
        error: 'Restoration failed: Compilation failed',
      });
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
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined) // First graph not registered
        .mockReturnValueOnce(undefined); // Second graph not registered
      vi.mocked(graphCompiler.compile)
        .mockResolvedValueOnce(mockCompiledGraph) // First graph compiles successfully
        .mockRejectedValueOnce(compilationError); // Second graph fails
      vi.mocked(graphDao.updateById).mockResolvedValue(mockGraph2);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledTimes(2);
      expect(graphRegistry.register).toHaveBeenCalledTimes(1);
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraph2.id, {
        status: GraphStatus.Error,
        error: 'Restoration failed: Compilation failed',
      });
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
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.destroyNotCompiledGraph).mockResolvedValue(
        undefined,
      );
      vi.mocked(graphCompiler.compile).mockResolvedValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      expect(graphDao.getTemporaryGraphs).toHaveBeenCalledTimes(1);
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      // Temporary graph should be destroyed using destroyNotCompiledGraph
      expect(graphCompiler.destroyNotCompiledGraph).toHaveBeenCalledWith(
        temporaryGraph,
      );
      expect(graphDao.deleteById).toHaveBeenCalledWith(temporaryGraph.id);
      // Then permanent graph should be compiled and registered
      expect(graphCompiler.compile).toHaveBeenCalledWith(permanentGraph);
      expect(graphRegistry.register).toHaveBeenCalledWith(
        permanentGraph.id,
        mockCompiledGraph,
      );
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
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined) // Not registered yet
        .mockReturnValueOnce(mockCompiledGraphWithAgent); // After registration, for thread resumption
      vi.mocked(graphCompiler.compile).mockResolvedValue(
        mockCompiledGraphWithAgent,
      );
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
      vi.mocked(graphRegistry.get).mockReturnValue(undefined);
      vi.mocked(graphCompiler.compile).mockResolvedValue(mockCompiledGraph);
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
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraphWithAgent);
      vi.mocked(graphCompiler.compile).mockResolvedValue(
        mockCompiledGraphWithAgent,
      );
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
      vi.mocked(graphRegistry.get)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockCompiledGraphWithAgent);
      vi.mocked(graphCompiler.compile).mockResolvedValue(
        mockCompiledGraphWithAgent,
      );
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
      // The graph should still be restored successfully
      expect(graphRegistry.register).toHaveBeenCalledWith(
        mockGraph.id,
        mockCompiledGraphWithAgent,
      );
    });
  });
});
