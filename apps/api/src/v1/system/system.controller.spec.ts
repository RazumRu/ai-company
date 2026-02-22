import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAppService } from '../github-app/services/github-app.service';
import { SystemController } from './system.controller';

describe('SystemController', () => {
  let controller: SystemController;
  let mockGitHubAppService: { isConfigured: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockGitHubAppService = {
      isConfigured: vi.fn(),
    };

    controller = new SystemController(
      mockGitHubAppService as unknown as GitHubAppService,
    );
  });

  describe('getSettings', () => {
    it('should return githubAppEnabled: true when configured', () => {
      mockGitHubAppService.isConfigured.mockReturnValue(true);
      const result = controller.getSettings();
      expect(result).toEqual({ githubAppEnabled: true });
    });

    it('should return githubAppEnabled: false when not configured', () => {
      mockGitHubAppService.isConfigured.mockReturnValue(false);
      const result = controller.getSettings();
      expect(result).toEqual({ githubAppEnabled: false });
    });
  });
});
