import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAppInstallationService } from '../services/github-app-installation.service';
import { GitHubAppController } from './github-app.controller';

describe('GitHubAppController', () => {
  let controller: GitHubAppController;
  let mockInstallationService: {
    getSetupInfo: ReturnType<typeof vi.fn>;
    linkViaOAuthCode: ReturnType<typeof vi.fn>;
    linkInstallation: ReturnType<typeof vi.fn>;
    listInstallations: ReturnType<typeof vi.fn>;
    unlinkInstallation: ReturnType<typeof vi.fn>;
    disconnectAll: ReturnType<typeof vi.fn>;
  };
  let mockCtx: { checkSub: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockInstallationService = {
      getSetupInfo: vi.fn().mockResolvedValue({
        installUrl: 'https://github.com/login/oauth/authorize?client_id=test',
        newInstallationUrl: '',
        configured: true,
        callbackPath: '/github-app/callback',
      }),
      linkViaOAuthCode: vi.fn().mockResolvedValue({
        linked: true,
        accountLogin: 'my-org',
        accountType: 'Organization',
      }),
      linkInstallation: vi.fn().mockResolvedValue({
        linked: true,
        accountLogin: 'my-org',
        accountType: 'Organization',
      }),
      listInstallations: vi.fn().mockResolvedValue({ installations: [] }),
      unlinkInstallation: vi.fn().mockResolvedValue({ unlinked: true }),
      disconnectAll: vi.fn().mockResolvedValue({ unlinked: true }),
    };

    mockCtx = {
      checkSub: vi.fn().mockReturnValue('user-123'),
    };

    controller = new GitHubAppController(
      mockInstallationService as unknown as GitHubAppInstallationService,
    );
  });

  describe('getSetupInfo', () => {
    it('should delegate to the installation service', async () => {
      const result = await controller.getSetupInfo();

      expect(mockInstallationService.getSetupInfo).toHaveBeenCalled();
      expect(result.configured).toBe(true);
    });
  });

  describe('linkViaOAuthCode', () => {
    it('should extract userId and delegate to the installation service', async () => {
      const result = await controller.linkViaOAuthCode(
        { code: 'auth-code' } as any,
        mockCtx as any,
      );

      expect(mockCtx.checkSub).toHaveBeenCalled();
      expect(mockInstallationService.linkViaOAuthCode).toHaveBeenCalledWith(
        'user-123',
        'auth-code',
      );
      expect(result.linked).toBe(true);
    });
  });

  describe('linkInstallation', () => {
    it('should parse installationId and delegate to the installation service', async () => {
      const result = await controller.linkInstallation(
        '12345',
        mockCtx as any,
      );

      expect(mockInstallationService.linkInstallation).toHaveBeenCalledWith(
        'user-123',
        12345,
      );
      expect(result.linked).toBe(true);
    });
  });

  describe('listInstallations', () => {
    it('should extract userId and delegate to the installation service', async () => {
      const result = await controller.listInstallations(mockCtx as any);

      expect(mockInstallationService.listInstallations).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result.installations).toEqual([]);
    });
  });

  describe('unlinkInstallation', () => {
    it('should parse installationId and delegate to the installation service', async () => {
      const result = await controller.unlinkInstallation(
        '12345',
        mockCtx as any,
      );

      expect(mockInstallationService.unlinkInstallation).toHaveBeenCalledWith(
        'user-123',
        12345,
      );
      expect(result.unlinked).toBe(true);
    });
  });

  describe('disconnectAll', () => {
    it('should extract userId and delegate to the installation service', async () => {
      const result = await controller.disconnectAll(mockCtx as any);

      expect(mockInstallationService.disconnectAll).toHaveBeenCalledWith(
        'user-123',
      );
      expect(result.unlinked).toBe(true);
    });
  });
});
