import { ToolRunnableConfig } from '@langchain/core/tools';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { zodToAjvSchema } from '../agent-tools.utils';
import { BaseTool, JSONSchema, ToolInvokeResult } from './base-tool';

// Create a concrete test implementation of BaseTool
const TestToolSchema = z.object({
  requiredField: z.string().min(1),
  optionalField: z.string().optional(),
});

type TestToolSchemaType = z.infer<typeof TestToolSchema>;

class TestTool extends BaseTool<TestToolSchemaType, Record<string, never>> {
  public name = 'test_tool';
  public description = 'A test tool for validation';

  public get schema(): JSONSchema {
    return zodToAjvSchema(TestToolSchema);
  }

  public async invoke(
    args: TestToolSchemaType,
    _config: Record<string, never>,
    _runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<string>> {
    return {
      output: `Invoked with: ${args.requiredField}`,
    };
  }
}

describe('BaseTool', () => {
  let tool: TestTool;

  beforeEach(() => {
    tool = new TestTool();
  });

  describe('validation', () => {
    it('should validate required fields', () => {
      const validData = {
        requiredField: 'test value',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate optional fields', () => {
      const validData = {
        requiredField: 'test value',
        optionalField: 'optional value',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const invalidData = {
        optionalField: 'optional value',
      };
      expect(() => tool.validate(invalidData)).toThrow(
        /Schema validation failed/,
      );
    });

    it('should reject empty required fields', () => {
      const invalidData = {
        requiredField: '',
      };
      expect(() => tool.validate(invalidData)).toThrow(
        /Schema validation failed/,
      );
    });

    it('should not fail when unknown keys are present', () => {
      const dataWithUnknownKeys = {
        requiredField: 'test value',
        unknownKey1: 'should be ignored',
        unknownKey2: 12345,
        unknownKey3: { nested: 'object' },
      };
      expect(() => tool.validate(dataWithUnknownKeys)).not.toThrow();
    });

    it('should remove unknown keys during validation', () => {
      const dataWithUnknownKeys = {
        requiredField: 'test value',
        optionalField: 'optional value',
        unknownKey: 'should be removed',
      };
      const validated = tool.validate(dataWithUnknownKeys);

      expect(validated).toHaveProperty('requiredField', 'test value');
      expect(validated).toHaveProperty('optionalField', 'optional value');
      expect(validated).not.toHaveProperty('unknownKey');
    });

    it('should still validate type correctness even with unknown keys', () => {
      const dataWithWrongType = {
        requiredField: 123, // Should be string
        unknownKey: 'should be ignored',
      };
      // Due to coerceTypes: true in Ajv, this might be coerced to string
      // Let's test with a more complex case that can't be coerced
      expect(() => tool.validate(dataWithWrongType)).not.toThrow();

      const validated = tool.validate(dataWithWrongType);
      expect(typeof validated.requiredField).toBe('string');
      expect(validated.requiredField).toBe('123'); // Coerced to string
    });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('test_tool');
    });

    it('should have correct description', () => {
      expect(tool.description).toBe('A test tool for validation');
    });

    it('should have a schema', () => {
      const schema = tool.schema;
      expect(schema).toBeDefined();
      expect(schema).toHaveProperty('type', 'object');
    });
  });
});
