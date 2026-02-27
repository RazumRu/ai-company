import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubAppService } from '../github-app/services/github-app.service';
import { AuthProviderType } from './dto/system.dto';
import { SystemController } from './system.controller';

const KEYCLOAK_URL = 'http://localhost:8082';
const KEYCLOAK_REALM = 'geniro';
const KEYCLOAK_CLIENT_ID = 'geniro';
const ZITADEL_ISSUER = 'http://localhost:8085';
const ZITADEL_CLIENT_ID = 'zitadel-geniro';

const mockEnvironment: Record<string, unknown> = {
  authProvider: 'keycloak',
  keycloakUrl: KEYCLOAK_URL,
  keycloakRealm: KEYCLOAK_REALM,
  keycloakClientId: KEYCLOAK_CLIENT_ID,
  zitadelIssuer: ZITADEL_ISSUER,
  zitadelClientId: ZITADEL_CLIENT_ID,
};

vi.mock('../../environments', () => ({
  get environment() {
    return mockEnvironment;
  },
}));

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

    // Reset to default for each test
    mockEnvironment.authProvider = 'keycloak';
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

  describe('getAuthConfig', () => {
    it('should return keycloak config when authProvider is keycloak', () => {
      mockEnvironment.authProvider = 'keycloak';

      const result = controller.getAuthConfig();

      expect(result).toEqual({
        provider: AuthProviderType.Keycloak,
        issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
        clientId: KEYCLOAK_CLIENT_ID,
      });
    });

    it('should return zitadel config when authProvider is zitadel', () => {
      mockEnvironment.authProvider = 'zitadel';

      const result = controller.getAuthConfig();

      expect(result).toEqual({
        provider: AuthProviderType.Zitadel,
        issuer: ZITADEL_ISSUER,
        clientId: ZITADEL_CLIENT_ID,
      });
    });
  });
});
