import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GhBranchTool } from './gh-branch.tool';
import { GhCloneTool } from './gh-clone.tool';
import { GhCommitTool } from './gh-commit.tool';
import { GhCreatePullRequestTool } from './gh-create-pull-request.tool';
import { GhPushTool } from './gh-push.tool';
import { GhToolGroup, GhToolGroupConfig, GhToolType } from './gh-tool-group';

describe('GhToolGroup', () => {
  let toolGroup: GhToolGroup;
  let mockGhCloneTool: GhCloneTool;
  let mockGhCommitTool: GhCommitTool;
  let mockGhBranchTool: GhBranchTool;
  let mockGhPushTool: GhPushTool;
  let mockGhCreatePullRequestTool: GhCreatePullRequestTool;

  beforeEach(async () => {
    mockGhCloneTool = {
      build: vi.fn(),
    } as unknown as GhCloneTool;

    mockGhCommitTool = {
      build: vi.fn(),
    } as unknown as GhCommitTool;

    mockGhBranchTool = {
      build: vi.fn(),
    } as unknown as GhBranchTool;

    mockGhPushTool = {
      build: vi.fn(),
    } as unknown as GhPushTool;

    mockGhCreatePullRequestTool = {
      build: vi.fn(),
    } as unknown as GhCreatePullRequestTool;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GhToolGroup,
        {
          provide: GhCloneTool,
          useValue: mockGhCloneTool,
        },
        {
          provide: GhCommitTool,
          useValue: mockGhCommitTool,
        },
        {
          provide: GhBranchTool,
          useValue: mockGhBranchTool,
        },
        {
          provide: GhPushTool,
          useValue: mockGhPushTool,
        },
        {
          provide: GhCreatePullRequestTool,
          useValue: mockGhCreatePullRequestTool,
        },
      ],
    }).compile();

    toolGroup = module.get<GhToolGroup>(GhToolGroup);
  });

  describe('buildTools', () => {
    it('should build and return array of tools', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(3);
      expect(result.tools[0]).toBe(mockCloneTool);
      expect(result.tools[1]).toBe(mockCommitTool);
      expect(result.tools[2]).toBe(mockBranchTool);
      expect(mockGhCloneTool.build).toHaveBeenCalledWith(config, undefined);
      expect(mockGhCommitTool.build).toHaveBeenCalledWith(config, undefined);
      expect(mockGhBranchTool.build).toHaveBeenCalledWith(config, undefined);
    });

    it('should pass lgConfig to tool build', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      const lgConfig = { description: 'Custom description' };
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };

      const result = toolGroup.buildTools(config, lgConfig);

      expect(result.tools).toEqual([
        mockCloneTool,
        mockCommitTool,
        mockBranchTool,
      ]);
      expect(mockGhCloneTool.build).toHaveBeenCalledWith(config, lgConfig);
      expect(mockGhCommitTool.build).toHaveBeenCalledWith(config, lgConfig);
      expect(mockGhBranchTool.build).toHaveBeenCalledWith(config, lgConfig);
    });

    it('should return multiple tools', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(3);
      expect(result.tools[0]).toBe(mockCloneTool);
      expect(result.tools[1]).toBe(mockCommitTool);
      expect(result.tools[2]).toBe(mockBranchTool);
    });

    it('should handle different configs', () => {
      const mockCloneTool1 = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool1 = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool1 = { name: 'gh_branch' } as DynamicStructuredTool;
      const mockCloneTool2 = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool2 = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool2 = { name: 'gh_branch' } as DynamicStructuredTool;

      mockGhCloneTool.build = vi
        .fn()
        .mockReturnValueOnce(mockCloneTool1)
        .mockReturnValueOnce(mockCloneTool2);
      mockGhCommitTool.build = vi
        .fn()
        .mockReturnValueOnce(mockCommitTool1)
        .mockReturnValueOnce(mockCommitTool2);
      mockGhBranchTool.build = vi
        .fn()
        .mockReturnValueOnce(mockBranchTool1)
        .mockReturnValueOnce(mockBranchTool2);

      const config1: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_token_1',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };
      const config2: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_token_2',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };

      const result1 = toolGroup.buildTools(config1);
      const result2 = toolGroup.buildTools(config2);

      expect(result1.tools[0]).toBe(mockCloneTool1);
      expect(result1.tools[1]).toBe(mockCommitTool1);
      expect(result1.tools[2]).toBe(mockBranchTool1);
      expect(result2.tools[0]).toBe(mockCloneTool2);
      expect(result2.tools[1]).toBe(mockCommitTool2);
      expect(result2.tools[2]).toBe(mockBranchTool2);
      expect(mockGhCloneTool.build).toHaveBeenCalledTimes(2);
      expect(mockGhCommitTool.build).toHaveBeenCalledTimes(2);
      expect(mockGhBranchTool.build).toHaveBeenCalledTimes(2);
    });

    it('should build tools based on tools array', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Clone, GhToolType.Commit, GhToolType.Branch],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(3);
      expect(result.tools).toEqual([
        mockCloneTool,
        mockCommitTool,
        mockBranchTool,
      ]);
    });

    it('should build only specified tools', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Clone, GhToolType.Commit],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(2);
      expect(result.tools).toEqual([mockCloneTool, mockCommitTool]);
      expect(mockGhBranchTool.build).not.toHaveBeenCalled();
    });

    it('should build single tool when only one is specified', () => {
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Commit],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(1);
      expect(result.tools).toEqual([mockCommitTool]);
      expect(mockGhCloneTool.build).not.toHaveBeenCalled();
      expect(mockGhBranchTool.build).not.toHaveBeenCalled();
    });

    it('should return empty array when tools array is empty', () => {
      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(0);
      expect(result.tools).toEqual([]);
      expect(mockGhCloneTool.build).not.toHaveBeenCalled();
      expect(mockGhCommitTool.build).not.toHaveBeenCalled();
      expect(mockGhBranchTool.build).not.toHaveBeenCalled();
    });

    it('should build tools in the order specified in array', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Branch, GhToolType.Clone, GhToolType.Commit],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(3);
      expect(result.tools).toEqual([
        mockBranchTool,
        mockCloneTool,
        mockCommitTool,
      ]);
    });

    it('should build PUSH tool when specified', () => {
      const mockPushTool = { name: 'gh_push' } as DynamicStructuredTool;
      mockGhPushTool.build = vi.fn().mockReturnValue(mockPushTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.Push],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(1);
      expect(result.tools).toEqual([mockPushTool]);
      expect(mockGhPushTool.build).toHaveBeenCalledWith(config, undefined);
      expect(mockGhCloneTool.build).not.toHaveBeenCalled();
      expect(mockGhCommitTool.build).not.toHaveBeenCalled();
      expect(mockGhBranchTool.build).not.toHaveBeenCalled();
    });

    it('should build PUSH tool with other tools', () => {
      const mockCloneTool = { name: 'gh_clone' } as DynamicStructuredTool;
      const mockCommitTool = { name: 'gh_commit' } as DynamicStructuredTool;
      const mockBranchTool = { name: 'gh_branch' } as DynamicStructuredTool;
      const mockPushTool = { name: 'gh_push' } as DynamicStructuredTool;
      mockGhCloneTool.build = vi.fn().mockReturnValue(mockCloneTool);
      mockGhCommitTool.build = vi.fn().mockReturnValue(mockCommitTool);
      mockGhBranchTool.build = vi.fn().mockReturnValue(mockBranchTool);
      mockGhPushTool.build = vi.fn().mockReturnValue(mockPushTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [
          GhToolType.Clone,
          GhToolType.Commit,
          GhToolType.Branch,
          GhToolType.Push,
        ],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(4);
      expect(result.tools).toEqual([
        mockCloneTool,
        mockCommitTool,
        mockBranchTool,
        mockPushTool,
      ]);
      expect(mockGhPushTool.build).toHaveBeenCalledWith(config, undefined);
    });

    it('should build CreatePullRequest tool when specified', () => {
      const mockTool = {
        name: 'gh_create_pull_request',
      } as DynamicStructuredTool;
      mockGhCreatePullRequestTool.build = vi.fn().mockReturnValue(mockTool);

      const config: GhToolGroupConfig = {
        runtime: {} as any,
        patToken: 'ghp_test_token',
        tools: [GhToolType.CreatePullRequest],
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(1);
      expect(result.tools).toEqual([mockTool]);
      expect(mockGhCreatePullRequestTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockGhCloneTool.build).not.toHaveBeenCalled();
      expect(mockGhCommitTool.build).not.toHaveBeenCalled();
      expect(mockGhBranchTool.build).not.toHaveBeenCalled();
      expect(mockGhPushTool.build).not.toHaveBeenCalled();
    });
  });
});
