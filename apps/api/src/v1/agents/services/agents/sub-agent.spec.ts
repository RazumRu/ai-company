import { AIMessage } from '@langchain/core/messages';
import { ToolRunnableConfig } from '@langchain/core/tools';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubagentLoopConfig } from '../../../agent-tools/tools/common/subagents/subagent-loop-runner.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { SubAgent } from './sub-agent';

const { mockLlmInvokeRef } = vi.hoisted(() => ({
  mockLlmInvokeRef: vi.fn(),
}));

vi.mock('../../../../environments', () => ({
  environment: {
    toolMaxOutputTokens: 5000,
    litellmMasterKey: 'test-key',
    llmBaseUrl: 'http://localhost:4000',
  },
}));

// Mock ChatOpenAI so buildLLM() returns our controllable mock.
vi.mock('@langchain/openai', () => {
  // Use a regular function (not arrow) so it can be called with `new`.
  function MockChatOpenAI() {
    return {
      bindTools: vi.fn().mockReturnValue({
        invoke: mockLlmInvokeRef,
      }),
      model: 'test-model',
    };
  }
  return { ChatOpenAI: MockChatOpenAI };
});

// Suppress the noisy LangGraph "Setting a recursionLimit" warning
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('SubAgent', () => {
  let subAgent: SubAgent;
  let mockLitellmService: LitellmService;
  let mockLogger: DefaultLogger;

  const defaultCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
    configurable: { thread_id: 'thread-123' },
  };

  const makeConfig = (
    overrides?: Partial<SubagentLoopConfig>,
  ): SubagentLoopConfig => ({
    tools: [],
    systemPrompt: 'You are a test subagent.',
    model: 'test-model',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockLitellmService = {
      supportsParallelToolCall: vi.fn().mockResolvedValue(false),
      extractTokenUsageFromResponse: vi.fn().mockResolvedValue({
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
      }),
      sumTokenUsages: vi.fn().mockReturnValue(null),
    } as unknown as LitellmService;

    mockLogger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as DefaultLogger;

    subAgent = new SubAgent(mockLitellmService, mockLogger);
  });

  describe('simple completion', () => {
    it('should return result when LLM responds without tool calls', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Found 5 TypeScript files',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.run(
        'Find TS files',
        makeConfig(),
        defaultCfg,
      );

      expect(result.result).toBe('Found 5 TypeScript files');
      expect(result.statistics.totalIterations).toBe(1);
      expect(result.statistics.toolCallsMade).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('should use fallback content when LLM returns empty content', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.run(
        'Do something',
        makeConfig(),
        defaultCfg,
      );

      expect(result.result).toBe('Task completed.');
    });
  });

  describe('abort signal', () => {
    it('should respect abort signal before graph invocation', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await subAgent.run('Find files', makeConfig(), {
        ...defaultCfg,
        signal: abortController.signal,
      });

      expect(result.error).toBe('Aborted');
      expect(result.statistics.totalIterations).toBe(0);
      expect(mockLlmInvokeRef).not.toHaveBeenCalled();
    });
  });

  describe('token usage extraction', () => {
    it('should return null usage when no tokens were consumed', async () => {
      vi.mocked(
        mockLitellmService.extractTokenUsageFromResponse,
      ).mockResolvedValue(null);

      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Result',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.run('Find files', makeConfig(), defaultCfg);

      expect(result.statistics.usage).toBeNull();
    });

    it('should extract non-zero usage from state', async () => {
      vi.mocked(
        mockLitellmService.extractTokenUsageFromResponse,
      ).mockResolvedValue({
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
      });

      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Result',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.run('Find files', makeConfig(), defaultCfg);

      expect(result.statistics.usage).toBeTruthy();
      expect(result.statistics.usage!.inputTokens).toBeGreaterThan(0);
      expect(result.statistics.usage!.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should propagate non-abort errors', async () => {
      mockLlmInvokeRef.mockRejectedValueOnce(
        new Error('LLM connection failed'),
      );

      await expect(
        subAgent.run('Find files', makeConfig(), defaultCfg),
      ).rejects.toThrow('LLM connection failed');
    });

    it('should treat AbortError as abort', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockLlmInvokeRef.mockRejectedValueOnce(abortError);

      const result = await subAgent.run('Find files', makeConfig(), defaultCfg);

      expect(result.error).toBe('Aborted');
      expect(result.statistics.totalIterations).toBe(0);
    });
  });
});
