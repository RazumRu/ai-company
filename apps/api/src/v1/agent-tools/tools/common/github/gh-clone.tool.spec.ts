import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/agents.types';
import { GitRepositoriesDao } from '../../../../git-repositories/dao/git-repositories.dao';
import { GitRepositoryEntity } from '../../../../git-repositories/entity/git-repository.entity';
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
      resolveTokenForOwner: vi.fn().mockResolvedValue('ghp_test_token'),
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
        thread_created_by: 'user-123',
        graph_project_id: 'project-456',
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
      expect(mockGitRepositoriesDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'octocat',
          repo: 'Hello-World',
          url: 'https://github.com/octocat/Hello-World.git',
        }),
      );
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
      } as Partial<GitRepositoryEntity> as GitRepositoryEntity);

      await tool.invoke(args, mockConfig, mockCfg);

      expect(mockGitRepositoriesDao.updateById).toHaveBeenCalledWith(
        'existing-id',
        expect.objectContaining({
          url: 'https://github.com/octocat/Hello-World.git',
        }),
      );
    });

    it('should use git clone when no token is available', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      const noTokenConfig: GhBaseToolConfig = {
        runtimeProvider: mockConfig.runtimeProvider,
        resolveTokenForOwner: vi.fn().mockResolvedValue(null),
      };

      const execGhCommandSpy = vi
        .spyOn(tool as any, 'execGhCommand')
        .mockResolvedValue({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      await tool.invoke(args, noTokenConfig, mockCfg);

      expect(execGhCommandSpy).toHaveBeenCalled();
      const firstCallParams = execGhCommandSpy.mock.calls[0]![0] as {
        cmd: string;
        resolvedToken: string | null;
      };
      expect(firstCallParams.cmd).toContain('git clone');
      expect(firstCallParams.cmd).not.toContain('gh repo clone');
      expect(firstCallParams.cmd).toContain('[clone-heartbeat]');
      expect(firstCallParams.resolvedToken).toBeNull();
    });

    it('should retry with git clone when authenticated clone fails', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'detectDefaultBranch').mockResolvedValue('main');
      vi.spyOn(tool as any, 'findAgentInstructions').mockResolvedValue(
        undefined,
      );

      const execGhCommandSpy = vi
        .spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Repository not granted to installation',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      await tool.invoke(args, mockConfig, mockCfg);

      expect(execGhCommandSpy).toHaveBeenCalledTimes(2);

      const firstCallParams = execGhCommandSpy.mock.calls[0]![0] as {
        cmd: string;
        resolvedToken: string | null;
      };
      expect(firstCallParams.cmd).toContain(' clone --progress ');
      expect(firstCallParams.cmd).toContain('http.extraHeader');
      expect(firstCallParams.cmd).toContain('[clone-heartbeat]');
      expect(firstCallParams.resolvedToken).toBe('ghp_test_token');

      const secondCallParams = execGhCommandSpy.mock.calls[1]![0] as {
        cmd: string;
        resolvedToken: string | null;
      };
      expect(secondCallParams.cmd).toContain('git clone');
      expect(secondCallParams.cmd).not.toContain('gh repo clone');
      expect(secondCallParams.cmd).toContain('[clone-heartbeat]');
      expect(secondCallParams.resolvedToken).toBeNull();
    });
  });
});
