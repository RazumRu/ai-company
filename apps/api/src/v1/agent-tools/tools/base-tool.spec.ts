import { ToolRunnableConfig } from '@langchain/core/tools';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { BaseTool, ToolInvokeResult } from './base-tool';

// Create a concrete test implementation of BaseTool
const TestToolSchema = z.object({
  requiredField: z.string().min(1),
  optionalField: z.string().optional(),
});

type TestToolSchemaType = z.infer<typeof TestToolSchema>;

class TestTool extends BaseTool<TestToolSchemaType, Record<string, never>> {
  public name = 'test_tool';
  public description = 'A test tool for validation';

  public get schema() {
    return TestToolSchema;
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
        /Invalid input: expected string, received undefined/,
      );
    });

    it('should treat null optional fields as undefined (LLM null tolerance)', () => {
      // LLMs often emit explicit null for omitted optional parameters
      const dataWithNull = {
        requiredField: 'test value',
        optionalField: null,
      };
      const result = tool.validate(dataWithNull);
      expect(result).toEqual({ requiredField: 'test value' });
    });

    it('should reject null on required fields', () => {
      const dataWithNullRequired = {
        requiredField: null,
      };
      expect(() => tool.validate(dataWithNullRequired)).toThrow();
    });

    it('should reject wrong types', () => {
      const dataWithWrongType = {
        requiredField: 123, // Should be string
      };
      // Zod doesn't coerce types, so this should fail
      expect(() => tool.validate(dataWithWrongType)).toThrow();
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
      // schema is now a ZodSchema, check ajvSchema for JSON schema properties
      const ajvSchema = tool.ajvSchema;
      expect(ajvSchema).toBeDefined();
      expect(ajvSchema).toHaveProperty('type', 'object');
    });
  });
});
