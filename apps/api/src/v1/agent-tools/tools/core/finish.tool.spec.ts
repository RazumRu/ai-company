import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

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
      expect(tool.description).toContain('Signal task completion');
    });
  });

  describe('schema', () => {
    it('should validate required purpose and message fields', () => {
      const validData = {
        purpose: 'Completing the task',
        message: 'Task completed successfully',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = { message: 'Task completed successfully' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing message field', () => {
      const invalidData = { purpose: 'Completing the task' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate with needsMoreInfo', () => {
      const validData = {
        purpose: 'Asking for more information',
        message: 'What is the target deployment environment?',
        needsMoreInfo: true,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should default needsMoreInfo to false', () => {
      const validData = {
        purpose: 'Completing the task',
        message: 'Task completed successfully',
      };
      const parsed = tool.validate(validData);
      expect(parsed.needsMoreInfo).toBe(false);
    });

    it('should reject empty purpose', () => {
      const invalidData = {
        purpose: '',
        message: 'Task completed successfully',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty message', () => {
      const invalidData = {
        purpose: 'Completing the task',
        message: '',
      };
      expect(() => tool.validate(invalidData)).toThrow();
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

      const result = await builtTool.invoke({
        purpose: 'Completing the task',
        message,
      });

      expect(result.output).toBeInstanceOf(FinishToolResponse);
      expect((result.output as FinishToolResponse).message).toBe(message);
      expect((result.output as FinishToolResponse).needsMoreInfo).toBe(false);
    });

    it('should return FinishToolResponse with needsMoreInfo', async () => {
      const builtTool = tool.build({});

      const result = await builtTool.invoke({
        purpose: 'Asking for more information',
        message: 'What is the target environment?',
        needsMoreInfo: true,
      });

      expect(result.output).toBeInstanceOf(FinishToolResponse);
      expect((result.output as FinishToolResponse).message).toBe(
        'What is the target environment?',
      );
      expect((result.output as FinishToolResponse).needsMoreInfo).toBe(true);
    });

    it('should default needsMoreInfo to false', async () => {
      const builtTool = tool.build({});

      const result = await builtTool.invoke({
        purpose: 'Completing the task',
        message: 'Task completed',
      });

      expect(result.output).toBeInstanceOf(FinishToolResponse);
      expect((result.output as FinishToolResponse).message).toBe(
        'Task completed',
      );
      expect((result.output as FinishToolResponse).needsMoreInfo).toBe(false);
    });
  });

  describe('FinishToolResponse', () => {
    it('should create instance with message', () => {
      const message = 'Test message';
      const response = new FinishToolResponse(message);

      expect(response.message).toBe(message);
      expect(response.needsMoreInfo).toBe(false);
    });

    it('should create instance with needsMoreInfo', () => {
      const message = 'Need more info';
      const response = new FinishToolResponse(message, true);

      expect(response.message).toBe(message);
      expect(response.needsMoreInfo).toBe(true);
    });

    it('should default needsMoreInfo to false', () => {
      const message = 'Test message';
      const response = new FinishToolResponse(message);

      expect(response.message).toBe(message);
      expect(response.needsMoreInfo).toBe(false);
    });
  });
});
