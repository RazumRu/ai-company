import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ToolInvokeResult } from '../../../agent-tools/tools/base-tool';
import { LitellmService } from '../../../litellm/services/litellm.service';
import { filterMessagesForLlm } from '../../agents.utils';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { SubAgent, SubAgentSchemaType } from './sub-agent';

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
  return { ChatOpenAI: MockChatOpenAI, ChatOpenAICompletions: class {} };
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

  const defaultAgentConfig: SubAgentSchemaType = {
    instructions: 'You are a test subagent.',
    invokeModelName: 'test-model',
    maxIterations: 25,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLitellmService = {
      supportsParallelToolCall: vi.fn().mockResolvedValue(false),
      supportsResponsesApi: vi.fn().mockResolvedValue(false),
      supportsReasoning: vi.fn().mockResolvedValue(false),
      supportsStreaming: vi.fn().mockResolvedValue(false),
      supportsAssistantPrefill: vi.fn().mockResolvedValue(true),
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
    subAgent.setConfig(defaultAgentConfig);
  });

  describe('simple completion', () => {
    it('should return result when LLM responds without tool calls', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Found 5 TypeScript files',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find TS files')],
        defaultCfg,
      );

      expect(result.result).toBe('Found 5 TypeScript files');
      expect(result.statistics.totalIterations).toBe(1);
      expect(result.statistics.toolCallsMade).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('should extract result from array content blocks (output_text)', async () => {
      // Regression test: some providers (e.g. gpt-5.1-codex-mini via LiteLLM)
      // return content as an array of content blocks [{type: "output_text", text: "..."}]
      // instead of a plain string.  Before the fix this fell through to "Task completed."
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: [
            { type: 'output_text', text: 'Findings from analysis' },
          ] as any,
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Analyze the codebase')],
        defaultCfg,
      );

      expect(result.result).toBe('Findings from analysis');
      expect(result.error).toBeUndefined();
    });

    it('should extract result from mixed text and output_text content blocks', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: [
            { type: 'text', text: 'Part one' },
            { type: 'output_text', text: 'Part two' },
          ] as any,
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Do analysis')],
        defaultCfg,
      );

      expect(result.result).toBe('Part one\nPart two');
      expect(result.error).toBeUndefined();
    });

    it('should fallback after exhausting empty response retries', async () => {
      // All 3 responses are empty: 1 original + 2 retries = 3 total LLM calls
      mockLlmInvokeRef.mockResolvedValue(
        new AIMessage({
          content: '',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Do something')],
        defaultCfg,
      );

      expect(result.result).toBe('Task completed.');
      // 1 original + 2 retries = 3 LLM invocations
      expect(result.statistics.totalIterations).toBe(3);
      expect(mockLlmInvokeRef).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('empty response guard exhausted'),
      );
    });
  });

  describe('empty response guard', () => {
    it('should nudge LLM when it returns empty string content', async () => {
      // 1st call: empty content, no tool calls → nudge
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          response_metadata: { usage: {} },
        }),
      );
      // 2nd call (after nudge): real answer
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Here is the actual answer.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Do something')],
        defaultCfg,
      );

      expect(result.result).toBe('Here is the actual answer.');
      expect(result.error).toBeUndefined();
      expect(result.statistics.totalIterations).toBe(2);
      expect(mockLlmInvokeRef).toHaveBeenCalledTimes(2);
    });

    it('should nudge LLM when it returns empty output_text content block', async () => {
      // Exact scenario from the bug report: content is [{type: "output_text", text: ""}]
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: [{ type: 'output_text', text: '' }] as any,
          response_metadata: { usage: {} },
        }),
      );
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Real answer after nudge.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Research the codebase')],
        defaultCfg,
      );

      expect(result.result).toBe('Real answer after nudge.');
      expect(result.error).toBeUndefined();
      expect(result.statistics.totalIterations).toBe(2);
    });

    it('should not nudge when LLM returns non-empty content', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'A real answer on the first try.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Do something')],
        defaultCfg,
      );

      expect(result.result).toBe('A real answer on the first try.');
      expect(result.error).toBeUndefined();
      expect(result.statistics.totalIterations).toBe(1);
      expect(mockLlmInvokeRef).toHaveBeenCalledTimes(1);
    });

    it('should include nudge system message in retry LLM invocation', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          response_metadata: { usage: {} },
        }),
      );

      let capturedMessages: BaseMessage[] = [];
      mockLlmInvokeRef.mockImplementationOnce((msgs: BaseMessage[]) => {
        capturedMessages = msgs;
        return Promise.resolve(
          new AIMessage({
            content: 'Answer after nudge',
            response_metadata: { usage: {} },
          }),
        );
      });

      await subAgent.runSubagent(
        [new HumanMessage('Do something')],
        defaultCfg,
      );

      const systemMessages = capturedMessages.filter(
        (m) => m instanceof SystemMessage,
      );
      expect(
        systemMessages.some(
          (m) =>
            typeof m.content === 'string' &&
            m.content.includes('previous response was empty'),
        ),
      ).toBe(true);
    });
  });

  describe('abort signal', () => {
    it('should respect abort signal before graph invocation', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find files')],
        {
          ...defaultCfg,
          signal: abortController.signal,
        },
      );

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

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find files')],
        defaultCfg,
      );

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

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find files')],
        defaultCfg,
      );

      expect(result.statistics.usage).toBeTruthy();
      expect(result.statistics.usage!.inputTokens).toBeGreaterThan(0);
      expect(result.statistics.usage!.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('maxIterations', () => {
    it('should use maxIterations from config', async () => {
      // Make LLM always return tool calls so it loops until limit
      const toolCallMsg = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'nonexistent', args: {} }],
        response_metadata: { usage: {} },
      });
      mockLlmInvokeRef.mockResolvedValue(toolCallMsg);

      const result = await subAgent.runSubagent(
        [new HumanMessage('Loop forever')],
        defaultCfg,
      );

      expect(result.error).toBe('Max iterations reached');
      expect(result.result).toContain(String(defaultAgentConfig.maxIterations));
    });

    it('should respect custom maxIterations config', async () => {
      subAgent.setConfig({
        ...defaultAgentConfig,
        maxIterations: 5,
      });

      const toolCallMsg = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'nonexistent', args: {} }],
        response_metadata: { usage: {} },
      });
      mockLlmInvokeRef.mockResolvedValue(toolCallMsg);

      const result = await subAgent.runSubagent(
        [new HumanMessage('Loop forever')],
        defaultCfg,
      );

      expect(result.error).toBe('Max iterations reached');
      expect(result.result).toContain('5');
      // With maxIterations=5 the total LLM invocations should be less than 5
      expect(result.statistics.totalIterations).toBeLessThanOrEqual(5);
    });

    it('should include partial statistics in max iterations result', async () => {
      subAgent.setConfig({
        ...defaultAgentConfig,
        maxIterations: 5,
      });

      vi.mocked(
        mockLitellmService.extractTokenUsageFromResponse,
      ).mockResolvedValue({
        inputTokens: 100,
        outputTokens: 30,
        totalTokens: 130,
      });

      const toolCallMsg = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'nonexistent', args: {} }],
        response_metadata: { usage: {} },
      });
      mockLlmInvokeRef.mockResolvedValue(toolCallMsg);

      const result = await subAgent.runSubagent(
        [new HumanMessage('Loop forever')],
        defaultCfg,
      );

      expect(result.error).toBe('Max iterations reached');
      expect(result.statistics.totalIterations).toBeGreaterThanOrEqual(1);
    });
  });

  describe('maxContextTokens', () => {
    it('should stop when currentContext exceeds maxContextTokens', async () => {
      subAgent.setConfig({
        ...defaultAgentConfig,
        maxContextTokens: 500,
      });

      // Return currentContext in the token usage to trigger the limit
      vi.mocked(
        mockLitellmService.extractTokenUsageFromResponse,
      ).mockResolvedValue({
        inputTokens: 600,
        outputTokens: 30,
        totalTokens: 630,
        currentContext: 600,
      });

      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Partial result before limit.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Research the codebase')],
        defaultCfg,
      );

      expect(result.error).toBe('Context limit reached (600/500)');
      expect(result.result).toBe('Partial result before limit.');
      expect(result.statistics.totalIterations).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SubAgent hit context limit'),
      );
    });

    it('should not stop when currentContext is below maxContextTokens', async () => {
      subAgent.setConfig({
        ...defaultAgentConfig,
        maxContextTokens: 1000,
      });

      vi.mocked(
        mockLitellmService.extractTokenUsageFromResponse,
      ).mockResolvedValue({
        inputTokens: 200,
        outputTokens: 30,
        totalTokens: 230,
        currentContext: 200,
      });

      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Full result completed.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Quick task')],
        defaultCfg,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe('Full result completed.');
    });
  });

  describe('exploredFiles extraction', () => {
    it('should return empty array when no files were explored', async () => {
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'No files needed.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Answer a question')],
        defaultCfg,
      );

      expect(result.exploredFiles).toEqual([]);
    });

    it('should extract file paths from files_read tool calls', async () => {
      const mockReadTool = {
        name: 'files_read',
        description: 'Read files',
        schema: z.object({
          filesToRead: z.array(z.object({ filePath: z.string() })),
        }),
        invoke: vi.fn(async () => ({
          output: JSON.stringify({
            files: [{ content: 'file content' }],
          }),
        })),
      } as unknown as DynamicStructuredTool;

      subAgent.addTool(mockReadTool);
      subAgent.setConfig({ ...defaultAgentConfig, maxIterations: 10 });

      // 1st call: tool call to read files
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_read1',
              name: 'files_read',
              args: {
                filesToRead: [
                  { filePath: '/workspace/src/service.ts' },
                  { filePath: '/workspace/src/controller.ts' },
                ],
              },
              type: 'tool_call',
            },
          ],
          response_metadata: { usage: {} },
        }),
      );

      // 2nd call: final answer
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Found the service and controller.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Read the service files')],
        defaultCfg,
      );

      expect(result.exploredFiles).toEqual([
        '/workspace/src/controller.ts',
        '/workspace/src/service.ts',
      ]);
    });

    it('should return exploredFiles even on abort', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find files')],
        { ...defaultCfg, signal: abortController.signal },
      );

      expect(result.exploredFiles).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should propagate non-abort errors', async () => {
      mockLlmInvokeRef.mockRejectedValueOnce(
        new Error('LLM connection failed'),
      );

      await expect(
        subAgent.runSubagent([new HumanMessage('Find files')], defaultCfg),
      ).rejects.toThrow('LLM connection failed');
    });

    it('should treat AbortError as abort', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockLlmInvokeRef.mockRejectedValueOnce(abortError);

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find files')],
        defaultCfg,
      );

      expect(result.error).toBe('Aborted');
      expect(result.statistics.totalIterations).toBe(0);
    });
  });

  describe('tool call ID normalisation (infinite loop fix)', () => {
    /**
     * Helper: create a simple DynamicStructuredTool whose invoke() returns a
     * ToolInvokeResult. The tool records all invocations so tests can assert
     * how many times it was called and what state the messages were in.
     */
    function createMockTool(
      name: string,
      fn: (args: Record<string, unknown>) => ToolInvokeResult<unknown>,
    ): DynamicStructuredTool {
      const invocations: Record<string, unknown>[] = [];
      const mockTool = {
        name,
        description: `Mock ${name} tool`,
        schema: z.object({ query: z.string().optional() }),
        invoke: vi.fn(async (args: unknown) => {
          const parsed = args as Record<string, unknown>;
          invocations.push(parsed);
          return fn(parsed);
        }),
        __invocations: invocations,
      } as unknown as DynamicStructuredTool;
      return mockTool;
    }

    it('should complete without looping when LLM returns tool calls with undefined ids', async () => {
      // This is the core regression test for the infinite-loop bug.
      //
      // Scenario: The LLM (e.g. Gemini via LiteLLM) returns a tool_call with
      // id=undefined.  Before the fix, ToolExecutorNode would create a
      // ToolMessage with a generated missing_id_xxx, but the AIMessage still
      // had id=undefined.  filterMessagesForLlm would then drop the ToolMessage
      // as "dangling" because its tool_call_id didn't match any safe AI tool
      // call id.  The LLM would only see the original human message and repeat
      // the same tool call, looping until maxIterations.
      //
      // With the fix, ToolExecutorNode backpatches generated IDs onto the
      // AIMessage, so the pair always matches and the LLM sees tool results.

      const mockSearchTool = createMockTool('search', () => ({
        output: 'Found 3 files matching the query.',
      }));

      subAgent.addTool(mockSearchTool);
      subAgent.setConfig({ ...defaultAgentConfig, maxIterations: 10 });

      // 1st LLM call: returns a tool call with NO id (simulates Gemini bug)
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              // id is intentionally ABSENT — this is the bug scenario
              name: 'search',
              args: { query: 'typescript files' },
              type: 'tool_call',
            },
          ],
          response_metadata: { usage: {} },
        }),
      );

      // 2nd LLM call: returns a final text response (no tool calls)
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'I found 3 TypeScript files.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Find TypeScript files')],
        defaultCfg,
      );

      // Must complete successfully — no max iterations error
      expect(result.error).toBeUndefined();
      expect(result.result).toBe('I found 3 TypeScript files.');

      // Exactly 2 LLM iterations: tool call + final answer
      expect(result.statistics.totalIterations).toBe(2);
      expect(result.statistics.toolCallsMade).toBe(1);

      // The tool was actually invoked
      expect(mockSearchTool.invoke).toHaveBeenCalledTimes(1);

      // The LLM was called exactly 2 times
      expect(mockLlmInvokeRef).toHaveBeenCalledTimes(2);

      // On the second LLM call, it should have received messages including
      // the ToolMessage (proving tool results were not filtered out)
      const secondCallMessages = mockLlmInvokeRef.mock
        .calls[1]![0] as BaseMessage[];
      const toolMessages = secondCallMessages.filter(
        (m) => m instanceof ToolMessage,
      );
      expect(toolMessages.length).toBe(1);
      expect(toolMessages[0]?.content).toContain('Found 3 files');
    });

    it('should pass tool results through filterMessagesForLlm when IDs are normalised', async () => {
      // Verify that filterMessagesForLlm correctly handles the normalised
      // state: AIMessage with generated_id + ToolMessage with same generated_id.

      const mockTool = createMockTool('read_file', () => ({
        output: 'file content here',
      }));

      subAgent.addTool(mockTool);
      subAgent.setConfig({ ...defaultAgentConfig, maxIterations: 10 });

      // 1st call: tool call with undefined id
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'read_file',
              args: { query: '/hello.js' },
              type: 'tool_call',
            },
          ],
          response_metadata: { usage: {} },
        }),
      );

      // Capture the messages sent to the LLM on the 2nd call
      let capturedMessages: BaseMessage[] = [];
      mockLlmInvokeRef.mockImplementationOnce((msgs: BaseMessage[]) => {
        capturedMessages = msgs;
        return Promise.resolve(
          new AIMessage({
            content: 'File content is: hello world',
            response_metadata: { usage: {} },
          }),
        );
      });

      const result = await subAgent.runSubagent(
        [new HumanMessage('Read /hello.js')],
        defaultCfg,
      );

      expect(result.error).toBeUndefined();
      expect(result.statistics.totalIterations).toBe(2);

      // Verify the messages the LLM saw on the second call pass through
      // filterMessagesForLlm without losing anything
      const filtered = filterMessagesForLlm(capturedMessages);

      // The system prompt message from InvokeLlmNode is prepended, so we
      // look for relative counts: all messages should survive filtering
      expect(filtered.length).toBe(capturedMessages.length);

      // Specifically, there should be exactly 1 ToolMessage present
      const toolMsgs = filtered.filter((m) => m instanceof ToolMessage);
      expect(toolMsgs.length).toBe(1);
      expect(toolMsgs[0]?.content).toContain('file content here');

      // And 1 AIMessage with tool_calls (the normalised one)
      const aiWithToolCalls = filtered.filter(
        (m) => m instanceof AIMessage && (m.tool_calls?.length ?? 0) > 0,
      );
      expect(aiWithToolCalls.length).toBe(1);

      // The AI tool call should now have a generated ID
      const tcId = (aiWithToolCalls[0] as AIMessage)?.tool_calls?.[0]?.id;
      expect(tcId).toBeDefined();
      expect(typeof tcId).toBe('string');
      expect(tcId!.startsWith('generated_id_')).toBe(true);

      // And the ToolMessage should reference the same ID
      const toolCallId = (toolMsgs[0] as ToolMessage).tool_call_id;
      expect(toolCallId).toBe(tcId);
    });

    it('should not loop when multiple tool calls have undefined ids', async () => {
      const mockTool1 = createMockTool('search', () => ({
        output: 'search results',
      }));
      const mockTool2 = createMockTool('read_file', () => ({
        output: 'file content',
      }));

      subAgent.addTool(mockTool1);
      subAgent.addTool(mockTool2);
      subAgent.setConfig({ ...defaultAgentConfig, maxIterations: 10 });

      // 1st call: two parallel tool calls, both with undefined ids
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'search', args: { query: 'ts files' }, type: 'tool_call' },
            { name: 'read_file', args: { query: '/a.ts' }, type: 'tool_call' },
          ],
          response_metadata: { usage: {} },
        }),
      );

      // 2nd call: final answer
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Done with both tools.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Search and read')],
        defaultCfg,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe('Done with both tools.');
      expect(result.statistics.totalIterations).toBe(2);
      expect(result.statistics.toolCallsMade).toBe(2);

      // Both tools were called
      expect(mockTool1.invoke).toHaveBeenCalledTimes(1);
      expect(mockTool2.invoke).toHaveBeenCalledTimes(1);

      // Second LLM call should include both ToolMessages
      const secondCallMessages = mockLlmInvokeRef.mock
        .calls[1]![0] as BaseMessage[];
      const toolMessages = secondCallMessages.filter(
        (m) => m instanceof ToolMessage,
      );
      expect(toolMessages.length).toBe(2);
    });

    it('should work correctly when LLM returns tool calls with proper ids (no regression)', async () => {
      // Verify that the fix doesn't break the normal case where IDs are present.

      const mockTool = createMockTool('search', () => ({
        output: 'results found',
      }));

      subAgent.addTool(mockTool);
      subAgent.setConfig({ ...defaultAgentConfig, maxIterations: 10 });

      // 1st call: tool call WITH a proper id
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              name: 'search',
              args: { query: 'test' },
              type: 'tool_call',
            },
          ],
          response_metadata: { usage: {} },
        }),
      );

      // 2nd call: final answer
      mockLlmInvokeRef.mockResolvedValueOnce(
        new AIMessage({
          content: 'Search completed successfully.',
          response_metadata: { usage: {} },
        }),
      );

      const result = await subAgent.runSubagent(
        [new HumanMessage('Search for test')],
        defaultCfg,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe('Search completed successfully.');
      expect(result.statistics.totalIterations).toBe(2);
      expect(result.statistics.toolCallsMade).toBe(1);

      // The ToolMessage should reference the original id (not a generated one)
      const secondCallMessages = mockLlmInvokeRef.mock
        .calls[1]![0] as BaseMessage[];
      const toolMessages = secondCallMessages.filter(
        (m) => m instanceof ToolMessage,
      );
      expect(toolMessages.length).toBe(1);
      expect((toolMessages[0] as ToolMessage).tool_call_id).toBe('call_abc123');
    });
  });
});
