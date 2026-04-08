import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeKind } from '../../graphs/graphs.types';
import type { InstructionBlockDefinition } from '../instruction-blocks.types';
import { InstructionBlockTemplateFactory } from './instruction-block-template.factory';
import type { InstructionBlocksService } from './instruction-blocks.service';

const CODING_GUIDELINES_DEFINITION: InstructionBlockDefinition = {
  id: 'coding-guidelines',
  name: 'Coding Guidelines',
  description: 'Standard coding guidelines for all projects.',
  instructions:
    'Always write clean, readable code with descriptive variable names.',
  contentHash: 'abc123def456',
  templateId: 'instruction-block-coding-guidelines',
};

describe('InstructionBlockTemplateFactory', () => {
  let factory: InstructionBlockTemplateFactory;
  let mockService: InstructionBlocksService;

  beforeEach(async () => {
    mockService = {
      getById: vi.fn().mockReturnValue(CODING_GUIDELINES_DEFINITION),
      getAll: vi.fn().mockReturnValue([]),
      getByTemplateId: vi.fn().mockReturnValue(undefined),
    } as unknown as InstructionBlocksService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [InstructionBlockTemplateFactory],
    }).compile();

    factory = module.get<InstructionBlockTemplateFactory>(
      InstructionBlockTemplateFactory,
    );
  });

  describe('createTemplate', () => {
    it('returns a template with correct id', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.id).toBe('instruction-block-coding-guidelines');
    });

    it('returns a template with correct name', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.name).toBe('Coding Guidelines');
    });

    it('returns a template with correct description', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.description).toBe(
        'Standard coding guidelines for all projects.',
      );
    });

    it('returns a template with Instruction kind', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.kind).toBe(NodeKind.Instruction);
    });

    it('exposes instructionBlockId metadata', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(
        (template as unknown as Record<string, unknown>).instructionBlockId,
      ).toBe('coding-guidelines');
    });

    it('exposes instructionBlockContentHash metadata', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(
        (template as unknown as Record<string, unknown>)
          .instructionBlockContentHash,
      ).toBe('abc123def456');
    });

    it('schema has name field with definition name as default', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const schema = (template as unknown as Record<string, unknown>)
        .schema as {
        shape: Record<string, { _def: { defaultValue: unknown } }>;
      };
      const nameField = schema.shape['name'];
      expect(nameField).toBeDefined();
      expect(nameField!._def.defaultValue).toBe('Coding Guidelines');
    });

    it('schema has content field with definition instructions as default', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const schema = (template as unknown as Record<string, unknown>)
        .schema as {
        shape: Record<string, { _def: { defaultValue: unknown } }>;
      };
      const contentField = schema.shape['content'];
      expect(contentField).toBeDefined();
      expect(contentField!._def.defaultValue).toBe(
        'Always write clean, readable code with descriptive variable names.',
      );
    });

    it('schema has instructionBlockId field with definition id as default', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const schema = (template as unknown as Record<string, unknown>)
        .schema as {
        shape: Record<string, { _def: { defaultValue: unknown } }>;
      };
      const field = schema.shape['instructionBlockId'];
      expect(field).toBeDefined();
      expect(field!._def.defaultValue).toBe('coding-guidelines');
    });

    it('schema has instructionBlockContentHash field with definition contentHash as default', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const schema = (template as unknown as Record<string, unknown>)
        .schema as {
        shape: Record<string, { _def: { defaultValue: unknown } }>;
      };
      const field = schema.shape['instructionBlockContentHash'];
      expect(field).toBeDefined();
      expect(field!._def.defaultValue).toBe('abc123def456');
    });

    it('has correct inputs (SimpleAgent kind, multiple)', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.inputs).toEqual([
        { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
      ]);
    });

    it('has empty outputs', () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      expect(template.outputs).toEqual([]);
    });
  });

  describe('template.create()', () => {
    const baseConfig = {
      name: 'Coding Guidelines',
      content:
        'Always write clean, readable code with descriptive variable names.',
      instructionBlockId: 'coding-guidelines',
      instructionBlockContentHash: 'abc123def456',
    };

    const metadata = {
      graphId: 'test-graph',
      nodeId: 'test-node',
      version: '1.0.0',
      graph_created_by: 'user-1',
      graph_project_id: '11111111-1111-1111-1111-111111111111',
    };

    it('provide() returns live instructions from service', async () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const handle = await template.create();
      const params = {
        config: baseConfig,
        inputNodeIds: new Set<string>(),
        outputNodeIds: new Set<string>(),
        metadata,
      };
      const result = await handle.provide(params);
      expect(result).toBe(
        'Always write clean, readable code with descriptive variable names.',
      );
      expect(mockService.getById).toHaveBeenCalledWith('coding-guidelines');
    });

    it('provide() uses updated instructions when .md changes', async () => {
      vi.mocked(mockService.getById).mockReturnValue({
        ...CODING_GUIDELINES_DEFINITION,
        instructions: 'Updated instructions from .md file.',
      });
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const handle = await template.create();
      const params = {
        config: baseConfig,
        inputNodeIds: new Set<string>(),
        outputNodeIds: new Set<string>(),
        metadata,
      };
      const result = await handle.provide(params);
      expect(result).toBe('Updated instructions from .md file.');
    });

    it('provide() falls back to config.content when definition is deleted', async () => {
      vi.mocked(mockService.getById).mockImplementation(() => {
        throw new NotFoundException('INSTRUCTION_BLOCK_NOT_FOUND', 'Not found');
      });
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const handle = await template.create();
      const params = {
        config: { ...baseConfig, content: 'Snapshot from node config.' },
        inputNodeIds: new Set<string>(),
        outputNodeIds: new Set<string>(),
        metadata,
      };
      const result = await handle.provide(params);
      expect(result).toBe('Snapshot from node config.');
    });

    it('configure() resolves without throwing', async () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const handle = await template.create();
      const params = {
        config: baseConfig,
        inputNodeIds: new Set<string>(),
        outputNodeIds: new Set<string>(),
        metadata,
      };
      const instance = await handle.provide(params);
      await expect(handle.configure(params, instance)).resolves.not.toThrow();
    });

    it('destroy() resolves without throwing', async () => {
      const template = factory.createTemplate(
        CODING_GUIDELINES_DEFINITION,
        mockService,
      );
      const handle = await template.create();
      const params = {
        config: baseConfig,
        inputNodeIds: new Set<string>(),
        outputNodeIds: new Set<string>(),
        metadata,
      };
      const instance = await handle.provide(params);
      await expect(handle.destroy(instance)).resolves.not.toThrow();
    });
  });
});
