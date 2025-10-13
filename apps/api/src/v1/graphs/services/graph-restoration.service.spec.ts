import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRestorationService } from './graph-restoration.service';

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
            invokeModelTemperature: 0.7,
          },
        },
        {
          id: 'trigger-1',
          template: 'manual-trigger',
          config: {
            agentId: 'agent-1',
          },
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
  };

  const mockCompiledGraph = {
    nodes: new Map(),
    edges: [],
    destroy: vi.fn(),
  };

  beforeEach(async () => {
    const mockGraphDao = {
      getRunningGraphs: vi.fn(),
      updateById: vi.fn(),
    };

    const mockGraphCompiler = {
      compile: vi.fn(),
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
      graphDao.getRunningGraphs.mockResolvedValue([mockGraph]);
      graphRegistry.get.mockReturnValue(undefined);
      graphCompiler.compile.mockResolvedValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledWith(mockGraph);
      expect(graphRegistry.register).toHaveBeenCalledWith(
        mockGraph.id,
        mockCompiledGraph,
      );
    });

    it('should handle no running graphs', async () => {
      // Arrange
      graphDao.getRunningGraphs.mockResolvedValue([]);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).not.toHaveBeenCalled();
      expect(graphRegistry.register).not.toHaveBeenCalled();
    });

    it('should handle compilation errors and update graph status', async () => {
      // Arrange
      const compilationError = new Error('Compilation failed');
      graphDao.getRunningGraphs.mockResolvedValue([mockGraph]);
      graphRegistry.get.mockReturnValue(undefined);
      graphCompiler.compile.mockRejectedValue(compilationError);
      graphDao.updateById.mockResolvedValue(mockGraph);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledWith(mockGraph);
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraph.id, {
        status: GraphStatus.Error,
        error: 'Restoration failed: Compilation failed',
      });
    });

    it('should skip already registered graphs', async () => {
      // Arrange
      graphDao.getRunningGraphs.mockResolvedValue([mockGraph]);
      graphRegistry.get.mockReturnValue(mockCompiledGraph);

      // Act
      await service.restoreRunningGraphs();

      // Assert
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

      graphDao.getRunningGraphs.mockResolvedValue([mockGraph, mockGraph2]);
      graphRegistry.get
        .mockReturnValueOnce(undefined) // First graph not registered
        .mockReturnValueOnce(undefined); // Second graph not registered
      graphCompiler.compile
        .mockResolvedValueOnce(mockCompiledGraph) // First graph compiles successfully
        .mockRejectedValueOnce(compilationError); // Second graph fails
      graphDao.updateById.mockResolvedValue(mockGraph2);

      // Act
      await service.restoreRunningGraphs();

      // Assert
      expect(graphDao.getRunningGraphs).toHaveBeenCalledTimes(1);
      expect(graphCompiler.compile).toHaveBeenCalledTimes(2);
      expect(graphRegistry.register).toHaveBeenCalledTimes(1);
      expect(graphDao.updateById).toHaveBeenCalledWith(mockGraph2.id, {
        status: GraphStatus.Error,
        error: 'Restoration failed: Compilation failed',
      });
    });
  });
});
