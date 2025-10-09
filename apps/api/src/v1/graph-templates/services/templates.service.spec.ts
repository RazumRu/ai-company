import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeKind } from '../../graphs/graphs.types';
import { TemplateRegistry } from './template-registry';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let templateRegistry: TemplateRegistry;

  const mockTemplates = [
    {
      name: 'test-tool-template',
      description: 'Test tool template',
      kind: NodeKind.Tool,
      schema: { type: 'object', properties: { name: { type: 'string' } } },
    },
    {
      name: 'test-runtime-template',
      description: 'Test runtime template',
      kind: NodeKind.Runtime,
      schema: { type: 'object', properties: { image: { type: 'string' } } },
    },
    {
      name: 'test-agent-template',
      description: 'Test agent template',
      kind: NodeKind.SimpleAgent,
      schema: { type: 'object', properties: { model: { type: 'string' } } },
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
        mockTemplates as any,
      );

      // Act
      const result = await service.getAllTemplates();

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: 'test-tool-template',
        description: 'Test tool template',
        kind: NodeKind.Tool,
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      });
      expect(result[1]).toEqual({
        name: 'test-runtime-template',
        description: 'Test runtime template',
        kind: NodeKind.Runtime,
        schema: { type: 'object', properties: { image: { type: 'string' } } },
      });
      expect(result[2]).toEqual({
        name: 'test-agent-template',
        description: 'Test agent template',
        kind: NodeKind.SimpleAgent,
        schema: { type: 'object', properties: { model: { type: 'string' } } },
      });
      expect(templateRegistry.getAllTemplates).toHaveBeenCalledOnce();
    });

    it('should return empty array when no templates are available', async () => {
      // Arrange
      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue([]);

      // Act
      const result = await service.getAllTemplates();

      // Assert
      expect(result).toEqual([]);
      expect(templateRegistry.getAllTemplates).toHaveBeenCalledOnce();
    });

    it('should handle templates with complex schemas', async () => {
      // Arrange
      const complexTemplate = {
        name: 'complex-template',
        description: 'Template with complex schema',
        kind: NodeKind.Tool,
        schema: {
          _def: {
            typeName: 'ZodObject',
            shape: {
              name: { _def: { typeName: 'ZodString' } },
              age: { _def: { typeName: 'ZodNumber' } },
            },
          },
        },
      };
      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue([
        complexTemplate,
      ] as any);

      // Act
      const result = await service.getAllTemplates();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'complex-template',
        description: 'Template with complex schema',
        kind: NodeKind.Tool,
        schema: {
          typeName: 'ZodObject',
          shape: {
            name: { _def: { typeName: 'ZodString' } },
            age: { _def: { typeName: 'ZodNumber' } },
          },
        },
      });
    });

    it('should handle templates with invalid schemas gracefully', async () => {
      // Arrange
      const invalidSchemaTemplate = {
        name: 'invalid-schema-template',
        description: 'Template with invalid schema',
        kind: NodeKind.Tool,
        schema: {
          _def: {
            circular: {},
          },
        },
      };
      // Create a circular reference to test JSON.stringify failure
      invalidSchemaTemplate.schema._def.circular =
        invalidSchemaTemplate.schema._def;

      vi.mocked(templateRegistry.getAllTemplates).mockReturnValue([
        invalidSchemaTemplate,
      ] as any);

      // Act
      const result = await service.getAllTemplates();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'invalid-schema-template',
        description: 'Template with invalid schema',
        kind: NodeKind.Tool,
        schema: {}, // Should fallback to empty object
      });
    });
  });

  describe('serializeSchema', () => {
    it('should serialize schema._def when available', () => {
      // Arrange
      const schema = {
        _def: { type: 'object', properties: { name: { type: 'string' } } },
      };

      // Act
      const result = (service as any).serializeSchema(schema);

      // Assert
      expect(result).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
      });
    });

    it('should serialize schema directly when _def is not available', () => {
      // Arrange
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };

      // Act
      const result = (service as any).serializeSchema(schema);

      // Assert
      expect(result).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
      });
    });

    it('should return empty object when serialization fails', () => {
      // Arrange
      const schema = {
        _def: {
          circular: {},
        },
      };
      // Create a circular reference
      schema._def.circular = schema._def;

      // Act
      const result = (service as any).serializeSchema(schema);

      // Assert
      expect(result).toEqual({});
    });

    it('should return empty object when schema is null or undefined', () => {
      // Act & Assert
      expect((service as any).serializeSchema(null)).toEqual({});
      expect((service as any).serializeSchema(undefined)).toEqual({});
    });
  });
});
