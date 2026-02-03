import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { GitRepositoriesDao } from '../../../../git-repositories/dao/git-repositories.dao';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhCloneTool, GhCloneToolSchemaType } from './gh-clone.tool';

describe('GhCloneTool', () => {
  let tool: GhCloneTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: GhBaseToolConfig;
  let mockGitRepositoriesDao: GitRepositoriesDao;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

    mockConfig = {
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as any,
      patToken: 'ghp_test_token',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GhCloneTool,
        {
          provide: GitRepositoriesDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
            updateById: vi.fn().mockResolvedValue({}),
          },
        },
        {
          provide: DefaultLogger,
          useValue: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        },
      ],
    }).compile();

    tool = module.get<GhCloneTool>(GhCloneTool);
    mockGitRepositoriesDao = module.get<GitRepositoriesDao>(GitRepositoriesDao);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_clone');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Clone a GitHub repository');
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
        userId: 'user-123',
      },
    };

    it('should clone repository and track it via DAO', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      await tool.invoke(args, mockConfig, mockCfg);

      expect(mockGitRepositoriesDao.getOne).toHaveBeenCalled();
      expect(mockGitRepositoriesDao.create).toHaveBeenCalled();
    });

    it('should update repository if it already exists', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      vi.spyOn(mockGitRepositoriesDao, 'getOne').mockResolvedValue({
        id: 'existing-id',
      } as any);

      await tool.invoke(args, mockConfig, mockCfg);

      expect(mockGitRepositoriesDao.updateById).toHaveBeenCalledWith(
        'existing-id',
        expect.objectContaining({
          url: 'https://github.com/octocat/Hello-World.git',
        }),
      );
    });
  });
});
