import type { DefaultLogger } from '@packages/common';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import { RuntimeProvider } from './runtime-provider';

describe('RuntimeProvider', () => {
  describe('cleanupRuntimesByNodeId', () => {
    it('should query by both graphId and nodeId', async () => {
      const runtimeInstanceDao: Pick<RuntimeInstanceDao, 'getAll'> = {
        getAll: vi.fn().mockResolvedValue([]),
      };

      const provider = new RuntimeProvider(
        runtimeInstanceDao as RuntimeInstanceDao,
        {} as DefaultLogger,
      );

      await provider.cleanupRuntimesByNodeId({
        graphId: 'graph-1',
        nodeId: 'runtime-1',
      });

      expect(runtimeInstanceDao.getAll).toHaveBeenCalledWith({
        graphId: 'graph-1',
        nodeId: 'runtime-1',
      });
    });
  });
});
