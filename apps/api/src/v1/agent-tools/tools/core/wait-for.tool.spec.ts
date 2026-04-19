import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@packages/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { WaitForTool } from './wait-for.tool';

describe('WaitForTool', () => {
  let tool: WaitForTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WaitForTool],
    }).compile();

    tool = module.get<WaitForTool>(WaitForTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('wait_for');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Schedule a delayed resumption');
    });

    it('description mentions the root-agent-only restriction', () => {
      expect(tool.description).toContain('Only the root agent');
      expect(tool.description).toContain('inter-agent communication');
    });

    it('detailed instructions include the callee restriction', () => {
      const instructions = tool.getDetailedInstructions({});
      expect(instructions).toContain('WAIT_FOR_FORBIDDEN_IN_CALLEE');
      expect(instructions).toContain('Restriction: Inter-Agent Callees');
    });
  });

  describe('schema', () => {
    it('should validate valid input', () => {
      const validData = {
        durationSeconds: 60,
        checkPrompt: 'Check the CI pipeline status',
        reason: 'Waiting for CI to complete',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject durationSeconds of 0', () => {
      const invalidData = {
        durationSeconds: 0,
        checkPrompt: 'Check status',
        reason: 'Waiting',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject durationSeconds exceeding 86400', () => {
      const invalidData = {
        durationSeconds: 86401,
        checkPrompt: 'Check status',
        reason: 'Waiting',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should accept durationSeconds at boundaries (1 and 86400)', () => {
      const minData = {
        durationSeconds: 1,
        checkPrompt: 'Check status',
        reason: 'Waiting',
      };
      const maxData = {
        durationSeconds: 86400,
        checkPrompt: 'Check status',
        reason: 'Waiting',
      };
      expect(() => tool.validate(minData)).not.toThrow();
      expect(() => tool.validate(maxData)).not.toThrow();
    });

    it('should reject non-integer durationSeconds', () => {
      const invalidData = {
        durationSeconds: 30.5,
        checkPrompt: 'Check status',
        reason: 'Waiting',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty checkPrompt', () => {
      const invalidData = {
        durationSeconds: 60,
        checkPrompt: '',
        reason: 'Waiting',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty reason', () => {
      const invalidData = {
        durationSeconds: 60,
        checkPrompt: 'Check status',
        reason: '',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing fields', () => {
      expect(() => tool.validate({})).toThrow();
      expect(() => tool.validate({ durationSeconds: 60 })).toThrow();
      expect(() =>
        tool.validate({ durationSeconds: 60, checkPrompt: 'Check' }),
      ).toThrow();
    });
  });

  describe('invoke', () => {
    it('should return correct output shape with scheduledResumeAt', () => {
      const now = Date.now();
      const result = tool.invoke(
        {
          durationSeconds: 120,
          checkPrompt: 'Check PR #42 CI status',
          reason: 'Waiting for CI pipeline',
        },
        {},
        {} as never,
      );

      expect(result.output.message).toContain('120 seconds');
      expect(result.output.message).toContain('Waiting for CI pipeline');
      const resumeAt = new Date(result.output.scheduledResumeAt).getTime();
      expect(resumeAt).toBeGreaterThanOrEqual(now + 120 * 1000 - 1000);
      expect(resumeAt).toBeLessThanOrEqual(now + 120 * 1000 + 1000);
    });

    it('should return stateChange with done: true and waiting: true', () => {
      const result = tool.invoke(
        {
          durationSeconds: 60,
          checkPrompt: 'Check deployment',
          reason: 'Deployment in progress',
        },
        {},
        {} as never,
      );

      expect(result.stateChange).toEqual({
        done: true,
        waiting: true,
        durationSeconds: 60,
        checkPrompt: 'Check deployment',
        reason: 'Deployment in progress',
      });
    });

    it('should include messageMetadata with title', () => {
      const result = tool.invoke(
        {
          durationSeconds: 300,
          checkPrompt: 'Check status',
          reason: 'Waiting for build',
        },
        {},
        {} as never,
      );

      expect(result.messageMetadata).toEqual({ __title: 'Waiting for build' });
    });
  });

  describe('inter-agent callee guard', () => {
    const validArgs = {
      durationSeconds: 60,
      checkPrompt: 'Check status',
      reason: 'Waiting for external event',
    };

    it('throws BadRequestException with WAIT_FOR_FORBIDDEN_IN_CALLEE when configurable.__interAgentCommunication === true', () => {
      const cfg = {
        configurable: { __interAgentCommunication: true },
      } as never;

      try {
        tool.invoke(validArgs, {}, cfg);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).errorCode).toBe(
          'WAIT_FOR_FORBIDDEN_IN_CALLEE',
        );
        expect((error as BadRequestException).message).toContain(
          'invoked by another agent',
        );
        expect((error as BadRequestException).message).toContain('`finish`');
      }
    });

    it('succeeds when configurable.__interAgentCommunication is false', () => {
      const cfg = {
        configurable: { __interAgentCommunication: false },
      } as never;

      expect(() => tool.invoke(validArgs, {}, cfg)).not.toThrow();
    });

    it('succeeds when configurable.__interAgentCommunication is undefined', () => {
      const cfg = {
        configurable: { thread_id: 'root-thread' },
      } as never;

      expect(() => tool.invoke(validArgs, {}, cfg)).not.toThrow();
    });

    it('succeeds when configurable itself is undefined', () => {
      expect(() => tool.invoke(validArgs, {}, {} as never)).not.toThrow();
    });

    it('succeeds when cfg itself is undefined', () => {
      expect(() =>
        tool.invoke(validArgs, {}, undefined as unknown as never),
      ).not.toThrow();
    });
  });

  describe('static methods', () => {
    it('getStateFromToolsMetadata returns state when present', () => {
      const toolsMetadata = {
        wait_for: {
          done: true,
          waiting: true,
          durationSeconds: 60,
          checkPrompt: 'Check',
          reason: 'Waiting',
        },
      };
      const state = WaitForTool.getStateFromToolsMetadata(toolsMetadata);
      expect(state).toEqual(toolsMetadata.wait_for);
    });

    it('getStateFromToolsMetadata returns undefined when absent', () => {
      expect(WaitForTool.getStateFromToolsMetadata(undefined)).toBeUndefined();
      expect(WaitForTool.getStateFromToolsMetadata({})).toBeUndefined();
    });

    it('clearState returns correct shape', () => {
      const cleared = WaitForTool.clearState();
      expect(cleared).toEqual({
        wait_for: {
          done: false,
          waiting: false,
          durationSeconds: 0,
          checkPrompt: '',
          reason: '',
        },
      });
    });

    it('setState stores state under the correct key', () => {
      const state = {
        done: true,
        waiting: true,
        durationSeconds: 120,
        checkPrompt: 'Check PR',
        reason: 'CI running',
      };
      const result = WaitForTool.setState(state);
      expect(result).toEqual({ wait_for: state });
    });
  });

  describe('generateTitle', () => {
    it('should return the reason string', () => {
      const builtTool = tool.build({});
      const title = builtTool.__titleFromArgs?.({
        durationSeconds: 60,
        checkPrompt: 'Check status',
        reason: 'Waiting for deployment',
      });
      expect(title).toBe('Waiting for deployment');
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const builtTool = tool.build({});
      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('wait_for');
    });

    it('should include detailed instructions', () => {
      const builtTool = tool.build({});
      expect(builtTool.__instructions).toContain(
        'Schedule a delayed resumption',
      );
    });
  });
});
