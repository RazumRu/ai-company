import { Test } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessagesDao } from './dao/messages.dao';
import { ThreadsDao } from './dao/threads.dao';
import { ThreadsListener } from './threads.listener';

describe('ThreadsListener', () => {
  let listener: ThreadsListener;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ThreadsListener,
        {
          provide: ThreadsDao,
          useValue: { getAll: vi.fn(), delete: vi.fn() },
        },
        {
          provide: MessagesDao,
          useValue: { delete: vi.fn() },
        },
        { provide: DefaultLogger, useValue: { log: vi.fn(), error: vi.fn() } },
      ],
    }).compile();

    listener = module.get(ThreadsListener);
    threadsDao = module.get(ThreadsDao);
    messagesDao = module.get(MessagesDao);
  });

  it('deletes messages and threads for the deleted graph', async () => {
    const threads = [
      { id: 'thread-1', graphId: 'g-1' },
      { id: 'thread-2', graphId: 'g-1' },
    ];
    vi.mocked(threadsDao.getAll).mockResolvedValue(threads as never);
    vi.mocked(messagesDao.delete).mockResolvedValue(undefined as never);
    vi.mocked(threadsDao.delete).mockResolvedValue(undefined as never);

    await listener.onGraphDeleted({ graphId: 'g-1', userId: 'u-1' });

    expect(threadsDao.getAll).toHaveBeenCalledWith({
      graphId: 'g-1',
      createdBy: 'u-1',
    });
    expect(messagesDao.delete).toHaveBeenCalledWith({
      threadIds: ['thread-1', 'thread-2'],
    });
    expect(threadsDao.delete).toHaveBeenCalledWith({
      graphId: 'g-1',
      createdBy: 'u-1',
    });
  });

  it('skips delete when graph has no threads', async () => {
    vi.mocked(threadsDao.getAll).mockResolvedValue([]);

    await listener.onGraphDeleted({ graphId: 'g-1', userId: 'u-1' });

    expect(messagesDao.delete).not.toHaveBeenCalled();
    expect(threadsDao.delete).not.toHaveBeenCalled();
  });

  it('propagates DAO errors from threadsDao.getAll', async () => {
    vi.mocked(threadsDao.getAll).mockRejectedValue(new Error('DB failure'));

    await expect(
      listener.onGraphDeleted({ graphId: 'g-1', userId: 'u-1' }),
    ).rejects.toThrow('DB failure');
  });

  it('propagates DAO errors from messagesDao.delete', async () => {
    vi.mocked(threadsDao.getAll).mockResolvedValue([{ id: 't-1' }] as never);
    vi.mocked(messagesDao.delete).mockRejectedValue(new Error('Messages DB failure'));

    await expect(
      listener.onGraphDeleted({ graphId: 'g-1', userId: 'u-1' }),
    ).rejects.toThrow('Messages DB failure');
  });

  it('propagates DAO errors from threadsDao.delete', async () => {
    vi.mocked(threadsDao.getAll).mockResolvedValue([{ id: 't-1' }] as never);
    vi.mocked(messagesDao.delete).mockResolvedValue(undefined as never);
    vi.mocked(threadsDao.delete).mockRejectedValue(new Error('Threads DB failure'));

    await expect(
      listener.onGraphDeleted({ graphId: 'g-1', userId: 'u-1' }),
    ).rejects.toThrow('Threads DB failure');
  });
});
