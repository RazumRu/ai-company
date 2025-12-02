import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GhCloneTool } from './gh-clone.tool';
import { GhToolGroup, GhToolGroupConfig } from './gh-tool-group';

describe('GhToolGroup', () => {
  let toolGroup: GhToolGroup;
  let mockGhCloneTool: GhCloneTool;
  let mockConfig: GhToolGroupConfig;

  beforeEach(async () => {
    mockGhCloneTool = {
      build: vi.fn(),
    } as unknown as GhCloneTool;

    mockConfig = {
      runtime: {} as any,
      patToken: 'ghp_test_token',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GhToolGroup,
        {
          provide: GhCloneTool,
          useValue: mockGhCloneTool,
        },
      ],
    }).compile();

    toolGroup = module.get<GhToolGroup>(GhToolGroup);
  });

  describe('buildTools', () => {
    it('should build and return array of tools', () => {
      const mockTool = { name: 'gh_clone' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockTool);

      const result = toolGroup.buildTools(mockConfig);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(mockTool);
      expect(mockGhCloneTool.build).toHaveBeenCalledWith(mockConfig, undefined);
    });

    it('should pass lgConfig to tool build', () => {
      const mockTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const lgConfig = { description: 'Custom description' };
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockTool);

      const result = toolGroup.buildTools(mockConfig, lgConfig);

      expect(result).toEqual([mockTool]);
      expect(mockGhCloneTool.build).toHaveBeenCalledWith(mockConfig, lgConfig);
    });

    it('should return multiple tools when more are added', () => {
      const mockTool1 = { name: 'gh_clone' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockTool1);

      const result = toolGroup.buildTools(mockConfig);

      expect(result.length).toBe(1);
      expect(result[0]).toBe(mockTool1);
    });

    it('should handle different configs', () => {
      const mockTool1 = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockTool2 = { name: 'gh_clone' } as DynamicStructuredTool;

      mockGhCloneTool.build = vi
        .fn()
        .mockReturnValueOnce(mockTool1)
        .mockReturnValueOnce(mockTool2);

      const config1: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_token_1',
      };
      const config2: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_token_2',
      };

      const result1 = toolGroup.buildTools(config1);
      const result2 = toolGroup.buildTools(config2);

      expect(result1[0]).toBe(mockTool1);
      expect(result2[0]).toBe(mockTool2);
      expect(mockGhCloneTool.build).toHaveBeenCalledTimes(2);
    });
  });
});
