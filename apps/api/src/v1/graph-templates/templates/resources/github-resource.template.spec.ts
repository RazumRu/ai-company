import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import { GithubResource } from '../../../graph-resources/services/github-resource';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import {
  GithubResourceTemplate,
  GithubResourceTemplateSchema,
} from './github-resource.template';

describe('GithubResourceTemplate', () => {
  let template: GithubResourceTemplate;
  let mockGithubResource: GithubResource;

  beforeEach(async () => {
    mockGithubResource = {
      setup: vi.fn(),
      getData: vi.fn(),
      kind: 'Shell' as any,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubResourceTemplate,
        {
          provide: GithubResource,
          useValue: mockGithubResource,
        },
      ],
    }).compile();

    template = module.get<GithubResourceTemplate>(GithubResourceTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('github-resource');
    });

    it('should have correct description', () => {
      expect(template.description).toBe('GithHub resource');
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Resource);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(GithubResourceTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate correct schema', () => {
      const validData = {
        patToken: 'ghp_1234567890abcdef',
      };

      expect(() => GithubResourceTemplateSchema.parse(validData)).not.toThrow();
    });

    it('should reject missing patToken', () => {
      const invalidData = {};

      expect(() => GithubResourceTemplateSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty patToken', () => {
      const invalidData = {
        patToken: '',
      };

      expect(() => GithubResourceTemplateSchema.parse(invalidData)).toThrow();
    });

    it('should accept valid GitHub PAT token format', () => {
      const validData = {
        patToken: 'ghp_1234567890abcdef1234567890abcdef12345678',
      };

      expect(() => GithubResourceTemplateSchema.parse(validData)).not.toThrow();
    });
  });

  describe('create', () => {
    it('should call setup if available', async () => {
      const config = {
        patToken: 'ghp_1234567890abcdef',
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_1234567890abcdef',
          },
          initScript: ['echo "setup"'],
        },
      };

      vi.mocked(mockGithubResource.setup!).mockResolvedValue(undefined);
      vi.mocked(mockGithubResource.getData).mockResolvedValue(
        mockResourceOutput,
      );

      const compiledNodes = new Map<string, CompiledGraphNode>();
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const result = await template.create(config, compiledNodes, metadata);

      expect(mockGithubResource.setup).toHaveBeenCalledWith(config);
      expect(mockGithubResource.getData).toHaveBeenCalledWith(config);
      expect(result).toBe(mockResourceOutput);
    });

    it('should work without setup method', async () => {
      const config = {
        patToken: 'ghp_1234567890abcdef',
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_1234567890abcdef',
          },
          initScript: ['echo "setup"'],
        },
      };

      // Remove setup method
      delete (mockGithubResource as any).setup;
      vi.mocked(mockGithubResource.getData).mockResolvedValue(
        mockResourceOutput,
      );

      const compiledNodes = new Map<string, CompiledGraphNode>();
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const result = await template.create(config, compiledNodes, metadata);

      expect(mockGithubResource.getData).toHaveBeenCalledWith(config);
      expect(result).toBe(mockResourceOutput);
    });

    it('should handle setup errors', async () => {
      const config = {
        patToken: 'ghp_1234567890abcdef',
      };

      const setupError = new Error('Setup failed');
      vi.mocked(mockGithubResource.setup!).mockRejectedValue(setupError);

      const compiledNodes = new Map<string, CompiledGraphNode>();
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      await expect(
        template.create(config, compiledNodes, metadata),
      ).rejects.toThrow('Setup failed');
    });

    it('should handle getData errors', async () => {
      const config = {
        patToken: 'ghp_1234567890abcdef',
      };

      const getDataError = new Error('GetData failed');
      vi.mocked(mockGithubResource.setup!).mockResolvedValue(undefined);
      vi.mocked(mockGithubResource.getData).mockRejectedValue(getDataError);

      const compiledNodes = new Map<string, CompiledGraphNode>();
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      await expect(
        template.create(config, compiledNodes, metadata),
      ).rejects.toThrow('GetData failed');
    });

    it('should pass correct config to both setup and getData', async () => {
      const config = {
        patToken: 'ghp_test_token_123',
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_test_token_123',
          },
          initScript: ['echo "setup"'],
        },
      };

      vi.mocked(mockGithubResource.setup!).mockResolvedValue(undefined);
      vi.mocked(mockGithubResource.getData).mockResolvedValue(
        mockResourceOutput,
      );

      const compiledNodes = new Map<string, CompiledGraphNode>();
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      await template.create(config, compiledNodes, metadata);

      expect(mockGithubResource.setup).toHaveBeenCalledWith(config);
      expect(mockGithubResource.getData).toHaveBeenCalledWith(config);
    });
  });
});
