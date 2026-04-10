import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import {
  CustomInstructionTemplate,
  CustomInstructionTemplateSchema,
  CustomInstructionTemplateSchemaType,
} from './custom-instruction.template';

describe('CustomInstructionTemplate', () => {
  let template: CustomInstructionTemplate;

  const mockMetadata = {
    graphId: 'graph-1',
    nodeId: 'instruction-1',
    version: '1',
    graph_created_by: 'user-1',
    graph_project_id: '11111111-1111-1111-1111-111111111111',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomInstructionTemplate],
    }).compile();

    template = module.get<CustomInstructionTemplate>(CustomInstructionTemplate);
  });

  describe('properties', () => {
    it('should have correct id', () => {
      expect(template.id).toBe('custom-instruction');
    });

    it('should have correct name', () => {
      expect(template.name).toBe('Custom Instruction');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'A custom instruction block that injects user-defined text into connected agent system prompts.',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Instruction);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(CustomInstructionTemplateSchema);
    });

    it('should have inputs with SimpleAgent kind', () => {
      expect(template.inputs).toHaveLength(1);
      expect(template.inputs[0]).toMatchObject({
        type: 'kind',
        value: NodeKind.SimpleAgent,
        multiple: true,
      });
    });

    it('should have empty outputs', () => {
      expect(template.outputs).toHaveLength(0);
    });
  });

  describe('schema validation', () => {
    it('should validate correct input with name and content', () => {
      const valid = { name: 'My Instruction', content: 'Do something useful.' };
      expect(() => CustomInstructionTemplateSchema.parse(valid)).not.toThrow();
    });

    it('should apply default name when name is omitted', () => {
      const parsed = CustomInstructionTemplateSchema.parse({
        content: 'Some content',
      });
      expect(parsed.name).toBe('Custom Instruction');
    });

    it('should reject missing content', () => {
      expect(() =>
        CustomInstructionTemplateSchema.parse({ name: 'Test' }),
      ).toThrow();
    });

    it('should reject empty content string', () => {
      expect(() =>
        CustomInstructionTemplateSchema.parse({ name: 'Test', content: '' }),
      ).toThrow();
    });

    it('should reject empty name string', () => {
      expect(() =>
        CustomInstructionTemplateSchema.parse({
          name: '',
          content: 'Valid content',
        }),
      ).toThrow();
    });
  });

  describe('create', () => {
    it('should return handle where provide() returns content string', async () => {
      const config: CustomInstructionTemplateSchemaType = {
        name: 'My Instruction',
        content: 'Always respond in JSON format.',
      };
      const params: GraphNode<CustomInstructionTemplateSchemaType> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };

      const handle = await template.create();
      const result = await handle.provide(params);

      expect(result).toBe('Always respond in JSON format.');
    });

    it('should return the exact content string from config', async () => {
      const content = 'You are a helpful assistant.\nAlways be concise.';
      const config: CustomInstructionTemplateSchemaType = {
        name: 'Test',
        content,
      };
      const params: GraphNode<CustomInstructionTemplateSchemaType> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };

      const handle = await template.create();
      const result = await handle.provide(params);

      expect(result).toBe(content);
    });

    it('should complete configure() without error', async () => {
      const config: CustomInstructionTemplateSchemaType = {
        name: 'Test',
        content: 'Some instruction.',
      };
      const params: GraphNode<CustomInstructionTemplateSchemaType> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };

      const handle = await template.create();
      const instance = await handle.provide(params);

      await expect(handle.configure(params, instance)).resolves.toBeUndefined();
    });

    it('should complete destroy() without error', async () => {
      const config: CustomInstructionTemplateSchemaType = {
        name: 'Test',
        content: 'Some instruction.',
      };
      const params: GraphNode<CustomInstructionTemplateSchemaType> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };

      const handle = await template.create();
      const instance = await handle.provide(params);

      await expect(handle.destroy(instance)).resolves.toBeUndefined();
    });
  });
});
