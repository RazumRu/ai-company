import { Test } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitRepositoriesDao } from './dao/git-repositories.dao';
import { GitRepositoriesListener } from './git-repositories.listener';

describe('GitRepositoriesListener', () => {
  let listener: GitRepositoriesListener;
  let gitRepositoriesDao: GitRepositoriesDao;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GitRepositoriesListener,
        { provide: GitRepositoriesDao, useValue: { delete: vi.fn() } },
        { provide: DefaultLogger, useValue: { log: vi.fn(), error: vi.fn() } },
      ],
    }).compile();

    listener = module.get(GitRepositoriesListener);
    gitRepositoriesDao = module.get(GitRepositoriesDao);
  });

  it('deletes git repositories for the deleted project', async () => {
    vi.mocked(gitRepositoriesDao.delete).mockResolvedValue(undefined as never);

    await listener.onProjectDeleted({ projectId: 'p-1', userId: 'u-1' });

    expect(gitRepositoriesDao.delete).toHaveBeenCalledWith({
      projectId: 'p-1',
      createdBy: 'u-1',
    });
  });

  it('propagates DAO errors', async () => {
    vi.mocked(gitRepositoriesDao.delete).mockRejectedValue(
      new Error('DB failure'),
    );

    await expect(
      listener.onProjectDeleted({ projectId: 'p-1', userId: 'u-1' }),
    ).rejects.toThrow('DB failure');
  });
});
