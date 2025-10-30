import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
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
          provide: DefaultLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GraphRestorationService>(GraphRestorationService);
    graphDao = module.get(GraphDao);
    graphCompiler = module.get(GraphCompiler);
    graphRegistry = module.get(GraphRegistry);
    logger = module.get(DefaultLogger);
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
  });
});
