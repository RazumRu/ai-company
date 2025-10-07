import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FinishTool, FinishToolResponse } from './finish.tool';

describe('FinishTool', () => {
  let tool: FinishTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinishTool],
    }).compile();

    tool = module.get<FinishTool>(FinishTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('finish');
    });

    it('should have correct description', () => {
      expect(tool.description).toBe(
        'Signal the current task is complete. Call this before ending when output is restricted.',
      );
    });

    it('should be marked as system tool', () => {
      expect(tool.system).toBe(true);
    });
  });

  describe('schema', () => {
    it('should validate optional message', () => {
      const validData = { message: 'Task completed successfully' };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should validate empty object', () => {
      const validData = {};
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should validate undefined message', () => {
      const validData = { message: undefined };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const builtTool = tool.build({});

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('finish');
    });

    it('should return FinishToolResponse with message', async () => {
      const builtTool = tool.build({});
      const message = 'Task completed successfully';

      const result = await builtTool.invoke({ message });

      expect(result).toBeInstanceOf(FinishToolResponse);
      expect(result.message).toBe(message);
    });

    it('should return FinishToolResponse without message', async () => {
      const builtTool = tool.build({});

      const result = await builtTool.invoke({});

      expect(result).toBeInstanceOf(FinishToolResponse);
      expect(result.message).toBeUndefined();
    });

    it('should handle undefined message', async () => {
      const builtTool = tool.build({});

      const result = await builtTool.invoke({ message: undefined });

      expect(result).toBeInstanceOf(FinishToolResponse);
      expect(result.message).toBeUndefined();
    });
  });

  describe('FinishToolResponse', () => {
    it('should create instance with message', () => {
      const message = 'Test message';
      const response = new FinishToolResponse(message);

      expect(response.message).toBe(message);
    });

    it('should create instance without message', () => {
      const response = new FinishToolResponse();

      expect(response.message).toBeUndefined();
    });
  });
});
