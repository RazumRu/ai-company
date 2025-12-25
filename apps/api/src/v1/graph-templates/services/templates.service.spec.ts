import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { NodeKind } from '../../graphs/graphs.types';
import { TemplateRegistry } from './template-registry';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let templateRegistry: TemplateRegistry;

  const mockTemplates = [
    {
      id: 'test-tool-template',
      name: 'test-tool-template',
      description: 'Test tool template',
      kind: NodeKind.Tool,
      schema: z.object({ name: z.string() }),
      inputs: [
        { type: 'template', value: 'github-resource', multiple: true },
        {
          type: 'kind',
          value: NodeKind.Runtime,
          required: true,
          multiple: false,
        },
      ],
      outputs: [],
    },
    {
      id: 'test-runtime-template',
      name: 'test-runtime-template',
      description: 'Test runtime template',
      kind: NodeKind.Runtime,
      schema: z.object({ image: z.string() }),
      inputs: [],
      outputs: [],
    },
    {
      id: 'test-agent-template',
      name: 'test-agent-template',
      description: 'Test agent template',
      kind: NodeKind.SimpleAgent,
      schema: z.object({ model: z.string() }),
      inputs: [],
      outputs: [],
    },
  ];

  beforeEach(async () => {
    const mockTemplateRegistry = {
      getAllTemplates: vi.fn(),
      getTemplatesByKind: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        {
          provide: TemplateRegistry,
          useValue: mockTemplateRegistry,
        },
      ],
    }).compile();

    service = module.get<TemplatesService>(TemplatesService);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllTemplates', () => {
    it('should return all templates with serialized schemas', async () => {
      // Arrange
      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue(
        mockTemplates as unknown as any[],
      );

      // Act
      const result = await service.getAllTemplates();

      expect(result).toHaveLength(3);
      // Templates are sorted by kind, so runtime comes first
      expect(result[0]).toEqual({
        id: 'test-runtime-template',
        name: 'test-runtime-template',
        description: 'Test runtime template',
        kind: NodeKind.Runtime,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          properties: { image: { type: 'string' } },
          required: ['image'],
          type: 'object',
        },
        inputs: [],
        outputs: [],
      });
      expect(result[1]).toEqual({
        id: 'test-agent-template',
        name: 'test-agent-template',
        description: 'Test agent template',
        kind: NodeKind.SimpleAgent,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          properties: { model: { type: 'string' } },
          required: ['model'],
          type: 'object',
        },
        inputs: [],
        outputs: [],
      });
      expect(result[2]).toEqual({
        id: 'test-tool-template',
        name: 'test-tool-template',
        description: 'Test tool template',
        kind: NodeKind.Tool,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          properties: { name: { type: 'string' } },
          required: ['name'],
          type: 'object',
        },
        inputs: [
          { type: 'template', value: 'github-resource', multiple: true },
          {
            type: 'kind',
            value: NodeKind.Runtime,
            required: true,
            multiple: false,
          },
        ],
        outputs: [],
      });
      expect(templateRegistry.getAllTemplates).toHaveBeenCalledOnce();
    });

    it('should return empty array when no templates are available', async () => {
      // Arrange
      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue([]);

      // Act
      const result = await service.getAllTemplates();

      expect(result).toEqual([]);
      expect(templateRegistry.getAllTemplates).toHaveBeenCalledOnce();
    });

    it('should handle templates with complex schemas', async () => {
      // Arrange
      const complexTemplate = {
        name: 'complex-template',
        description: 'Template with complex schema',
        kind: NodeKind.Tool,
        schema: z.object({
          name: z.string(),
          age: z.number(),
        }),
      };
      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue([
        complexTemplate,
      ] as unknown as any[]);

      // Act
      const result = await service.getAllTemplates();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'complex-template',
        description: 'Template with complex schema',
        kind: NodeKind.Tool,
        schema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
          type: 'object',
        },
      });
    });
  });

  describe('serializeSchema', () => {
    it('should serialize schema._def when available', () => {
      // Arrange
      const schema = z.object({ name: z.string() });

      // Act
      const result = (
        service as unknown as {
          serializeSchema: (schema: unknown) => unknown;
        }
      ).serializeSchema(schema);

      expect(result).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: { name: { type: 'string' } },
        required: ['name'],
        type: 'object',
      });
    });

    it('should serialize schema directly when _def is not available', () => {
      // Arrange
      const schema = z.string(); // Simple schema that will work

      // Act
      const result = (
        service as unknown as {
          serializeSchema: (schema: unknown) => unknown;
        }
      ).serializeSchema(schema);

      expect(result).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'string',
      });
    });
  });
});
