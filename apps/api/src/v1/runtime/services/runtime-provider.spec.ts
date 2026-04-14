import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

vi.mock('../../../environments', () => ({
  environment: {
    dockerSocket: '/var/run/docker.sock',
    daytonaApiKey: 'test-daytona-key',
    daytonaApiUrl: 'http://daytona.local',
    daytonaTarget: 'local',
    k8sRuntimeNamespace: 'geniro-runtimes',
    k8sRuntimeImage: 'geniro/runtime:latest',
    k8sRuntimeClass: 'gvisor',
    k8sRuntimeServiceAccount: 'geniro-runtime',
    k8sRuntimeCpuRequest: '100m',
    k8sRuntimeCpuLimit: '1000m',
    k8sRuntimeMemoryRequest: '256Mi',
    k8sRuntimeMemoryLimit: '2Gi',
    k8sRuntimeReadyTimeoutMs: 60000,
    k8sInCluster: false,
  },
}));

vi.mock('./k8s-runtime', async () => {
  const K8sRuntime = vi.fn(function (
    this: unknown,
    config: unknown,
    options: unknown,
  ) {
    Object.assign(this as object, { _config: config, _options: options });
  });
  Object.assign(K8sRuntime, {
    stopByName: vi.fn().mockResolvedValue(undefined),
  });
  return { K8sRuntime };
});

import { DefaultLogger } from '@packages/common';

import { NotificationsService } from '../../notifications/services/notifications.service';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';
import { K8sRuntime } from './k8s-runtime';
import { K8sWarmPoolService } from './k8s-warm-pool.service';
import { RuntimeProvider } from './runtime-provider';

describe('RuntimeProvider', () => {
  let runtimeInstanceDao: ReturnType<typeof mock<RuntimeInstanceDao>>;
  let logger: ReturnType<typeof mock<DefaultLogger>>;
  let notificationsService: ReturnType<typeof mock<NotificationsService>>;

  beforeEach(() => {
    runtimeInstanceDao = mock<RuntimeInstanceDao>();
    logger = mock<DefaultLogger>();
    notificationsService = mock<NotificationsService>();
    vi.mocked(K8sRuntime.stopByName).mockResolvedValue(undefined);
  });

  function buildProvider(
    warmPoolService: K8sWarmPoolService | null = null,
  ): RuntimeProvider {
    return new RuntimeProvider(
      runtimeInstanceDao,
      logger,
      notificationsService,
      warmPoolService,
    );
  }

  describe('resolveRuntimeByType', () => {
    it('returns a K8sRuntime instance when K8sWarmPoolService is provided', () => {
      const warmPool = mock<K8sWarmPoolService>();
      const provider = buildProvider(warmPool);

      const runtime = provider['resolveRuntimeByType'](RuntimeType.K8s);

      expect(runtime).toBeInstanceOf(K8sRuntime);
    });

    it('returns a K8sRuntime instance when K8sWarmPoolService is null (absent from DI)', () => {
      const provider = buildProvider(null);

      const runtime = provider['resolveRuntimeByType'](RuntimeType.K8s);

      expect(runtime).toBeInstanceOf(K8sRuntime);
    });

    it('passes the warmPool to K8sRuntime when K8sWarmPoolService is provided', () => {
      const warmPool = mock<K8sWarmPoolService>();
      const provider = buildProvider(warmPool);

      provider['resolveRuntimeByType'](RuntimeType.K8s);

      expect(vi.mocked(K8sRuntime)).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'geniro-runtimes' }),
        expect.objectContaining({ warmPool }),
      );
    });

    it('passes null warmPool to K8sRuntime when K8sWarmPoolService is absent', () => {
      const provider = buildProvider(null);

      provider['resolveRuntimeByType'](RuntimeType.K8s);

      expect(vi.mocked(K8sRuntime)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ warmPool: null }),
      );
    });
  });

  describe('stopRuntime (K8s branch)', () => {
    it('calls K8sRuntime.stopByName when no cached runtime is present', async () => {
      const provider = buildProvider(null);

      const instance = {
        id: 'inst-k8s-1',
        type: RuntimeType.K8s,
        containerName: 'my-k8s-pod',
        graphId: 'graph-1',
        threadId: 'thread-1',
        nodeId: 'node-1',
        status: RuntimeInstanceStatus.Running,
      } as RuntimeInstanceEntity;

      runtimeInstanceDao.updateById.mockResolvedValue(1);

      notificationsService.emit.mockResolvedValue(undefined);

      await provider.stopRuntime(instance);

      expect(vi.mocked(K8sRuntime.stopByName)).toHaveBeenCalledWith(
        'my-k8s-pod',
        expect.objectContaining({ namespace: 'geniro-runtimes' }),
      );
    });
  });
});
