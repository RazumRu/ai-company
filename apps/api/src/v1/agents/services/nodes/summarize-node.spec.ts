import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { MockedFunction } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentState } from '../../agents.types';
import { BaseAgentConfigurable } from './base-node';
import { SummarizeNode } from './summarize-node';

vi.mock('@langchain/openai');

describe('SummarizeNode', () => {
  let node: SummarizeNode;
  let mockLlm: ChatOpenAI;
  let mockInvoke: MockedFunction<(messages: unknown[]) => Promise<AIMessage>>;
  let mockGetNumTokens: MockedFunction<(text: string) => Promise<number>>;

  beforeEach(async () => {
    mockInvoke = vi.fn() as MockedFunction<
      (messages: unknown[]) => Promise<AIMessage>
    >;
    mockGetNumTokens = vi.fn() as MockedFunction<
      (text: string) => Promise<number>
    >;
    mockLlm = {
      invoke: mockInvoke,
      getNumTokens: mockGetNumTokens,
    } as unknown as ChatOpenAI;

    node = new SummarizeNode(mockLlm, {
      maxTokens: 1000,
      keepTokens: 500,
    });
  });

  const createMockState = (
    overrides: Partial<BaseAgentState> = {},
  ): BaseAgentState => ({
    messages: [],
    summary: '',
    done: false,
    needsMoreInfo: false,
    toolUsageGuardActivated: false,
    toolUsageGuardActivatedCount: 0,
    ...overrides,
  });

  const createMockConfig =
    (): LangGraphRunnableConfig<BaseAgentConfigurable> => ({
      configurable: {
        run_id: 'test-run-id',
        thread_id: 'test-thread-id',
      },
    });

  describe('invoke', () => {
    it('should return messages unchanged if maxTokens <= 0', async () => {
      const nodeWithZeroMax = new SummarizeNode(mockLlm, {
        maxTokens: 0,
        keepTokens: 500,
      });
      const messages = [new HumanMessage('Test')];
      const state = createMockState({ messages });

      const result = await nodeWithZeroMax.invoke(state, createMockConfig());

      // No summarization/changes should be applied at all
      expect(result).toEqual({});
      expect(mockGetNumTokens).not.toHaveBeenCalled();
    });

    it('should return messages unchanged if total tokens <= maxTokens', async () => {
      const messages = [new HumanMessage('Test')];
      const state = createMockState({ messages, summary: '' });

      mockGetNumTokens.mockResolvedValue(100);

      const result = await node.invoke(state, createMockConfig());

      // No summarization/changes should be applied at all
      expect(result).toEqual({});
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should add system message when summarization occurs', async () => {
      const messages = Array.from(
        { length: 10 },
        (_, i) => new HumanMessage(`Message ${i}`),
      );
      const state = createMockState({
        messages,
        summary: '',
      });

      // Mock token counting - getNumTokens is called on each message content
      // For messages, return high token count per message to exceed maxTokens
      // For summary strings, return string length
      mockGetNumTokens.mockImplementation(async (text: string) => {
        // Check if this is a message content (starts with "Message")
        if (typeof text === 'string' && text.startsWith('Message')) {
          return 200; // High token count per message
        }
        // For summary or other strings
        return text.length;
      });

      // Mock the fold operation to return a new summary
      const newSummary = 'Summarized conversation';
      mockInvoke.mockResolvedValue(new AIMessage(newSummary));

      const result = await node.invoke(state, createMockConfig());

      expect(result.summary).toBe(newSummary);
      expect(result.messages?.items).toBeDefined();
      const returnedMessages = result.messages?.items || [];

      // Check that a system message was added indicating summarization
      const systemMessages = returnedMessages.filter(
        (m) => m instanceof SystemMessage,
      );
      expect(systemMessages.length).toBeGreaterThan(0);
      const summarySystemMessage = systemMessages.find((m) =>
        m.content.toString().includes('Summary updated'),
      );
      expect(summarySystemMessage).toBeDefined();
      expect(summarySystemMessage?.content).toContain(
        'Previous messages have been summarized',
      );
    });

    it('should mark summary message with hideForLlm flag', async () => {
      const messages = Array.from(
        { length: 10 },
        (_, i) => new HumanMessage(`Message ${i}`),
      );
      const state = createMockState({
        messages,
        summary: '',
      });

      mockGetNumTokens.mockImplementation(async (text: string) => {
        if (typeof text === 'string' && text.startsWith('Message')) {
          return 200;
        }
        return text.length;
      });

      const newSummary = 'Summarized conversation';
      mockInvoke.mockResolvedValue(new AIMessage(newSummary));

      const result = await node.invoke(state, createMockConfig());

      expect(result.messages?.items).toBeDefined();
      const returnedMessages = result.messages?.items || [];

      const summarySystemMessage = returnedMessages.find(
        (m) =>
          m instanceof SystemMessage &&
          m.content.toString().includes('Summary updated'),
      );
      expect(summarySystemMessage).toBeDefined();
      expect(summarySystemMessage?.additional_kwargs?.hideForLlm).toBe(true);
    });

    it('should not add system message when summary does not change', async () => {
      const existingSummary = 'Existing summary';
      const messages = [new HumanMessage('Test')];
      const state = createMockState({
        messages,
        summary: existingSummary,
      });

      // Mock token counting to be under maxTokens
      // Total = messages tokens + summary tokens should be <= maxTokens
      mockGetNumTokens.mockImplementation(async (text: string | unknown[]) => {
        if (typeof text === 'string') {
          return text.length; // Summary length
        }
        return 10; // Messages tokens - small to stay under maxTokens
      });

      const result = await node.invoke(state, createMockConfig());

      // When under maxTokens, summary is not returned in the change
      // The summary should remain unchanged in the state
      expect(result.summary).toBeUndefined(); // Summary not changed, so not in result
      const returnedMessages = result.messages?.items || [];
      const summarySystemMessages = returnedMessages.filter(
        (m) =>
          m instanceof SystemMessage &&
          m.content.toString().includes('Summary updated'),
      );
      expect(summarySystemMessages.length).toBe(0);
    });

    it('should not add system message when summary is empty', async () => {
      const messages = [new HumanMessage('Test message with enough tokens')];
      const state = createMockState({
        messages,
        summary: '',
      });

      // Mock token counting to exceed maxTokens
      mockGetNumTokens.mockImplementation(async (text: string) => {
        if (typeof text === 'string' && text.includes('Test message')) {
          return 2000; // High token count to exceed maxTokens
        }
        return text.length;
      });

      // Mock fold to return empty summary (simulating no older messages scenario)
      // But actually, if there are older messages, fold will be called
      // Let's simulate the case where fold returns empty
      mockInvoke.mockResolvedValue(new AIMessage(''));

      const result = await node.invoke(state, createMockConfig());

      const returnedMessages = result.messages?.items || [];
      const summarySystemMessages = returnedMessages.filter(
        (m) =>
          m instanceof SystemMessage &&
          m.content.toString().includes('Summary updated'),
      );
      // Summary is empty, so no system message should be added
      expect(summarySystemMessages.length).toBe(0);
    });

    it('should handle keepTokens = 0 by keeping only last message', async () => {
      const nodeWithZeroKeep = new SummarizeNode(mockLlm, {
        maxTokens: 1000,
        keepTokens: 0,
      });

      const messages = [
        new HumanMessage('Message 1'),
        new HumanMessage('Message 2'),
        new HumanMessage('Message 3'),
      ];
      const state = createMockState({
        messages,
        summary: '',
      });

      mockGetNumTokens.mockImplementation(async (text: string) => {
        if (typeof text === 'string' && text.startsWith('Message')) {
          return 500; // High token count per message to exceed maxTokens
        }
        return text.length;
      });

      mockInvoke.mockResolvedValue(new AIMessage('Summary'));

      const result = await nodeWithZeroKeep.invoke(state, createMockConfig());

      expect(result.summary).toBe('Summary');
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('should use custom systemNote when provided', async () => {
      const customSystemNote = 'Custom summarization instruction';
      const nodeWithCustomNote = new SummarizeNode(mockLlm, {
        maxTokens: 1000,
        keepTokens: 500,
        systemNote: customSystemNote,
      });

      const messages = Array.from(
        { length: 10 },
        (_, i) => new HumanMessage(`Message ${i}`),
      );
      const state = createMockState({
        messages,
        summary: '',
      });

      mockGetNumTokens.mockImplementation(async (text: string) => {
        if (typeof text === 'string' && text.startsWith('Message')) {
          return 200; // High token count per message to exceed maxTokens
        }
        return text.length;
      });

      mockInvoke.mockResolvedValue(new AIMessage('Summary'));

      await nodeWithCustomNote.invoke(state, createMockConfig());

      // Check that the custom system note was used in the fold operation
      const invokeCalls = mockInvoke.mock.calls;
      expect(invokeCalls.length).toBeGreaterThan(0);
      const firstCall = invokeCalls[0]?.[0] as SystemMessage[];
      const systemMessage = firstCall?.find((m) => m instanceof SystemMessage);
      expect(systemMessage?.content).toBe(customSystemNote);
    });
  });
});
