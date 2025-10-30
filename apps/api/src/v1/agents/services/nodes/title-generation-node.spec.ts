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
import { TitleGenerationNode } from './title-generation-node';

vi.mock('@langchain/openai');

describe('TitleGenerationNode', () => {
  let node: TitleGenerationNode;
  let mockLlm: ChatOpenAI;
  let mockInvoke: MockedFunction<(messages: unknown[]) => Promise<AIMessage>>;

  beforeEach(async () => {
    mockInvoke = vi.fn() as MockedFunction<
      (messages: unknown[]) => Promise<AIMessage>
    >;
    mockLlm = {
      invoke: mockInvoke,
    } as unknown as ChatOpenAI;

    node = new TitleGenerationNode(mockLlm);
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
    generatedTitle: undefined,
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
    it('should return empty object if title already exists', async () => {
      const state = createMockState({ generatedTitle: 'Existing Title' });

      const result = await node.invoke(state, createMockConfig());

      expect(result).toEqual({});
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should generate title from first human message', async () => {
      const humanMessage = new HumanMessage('What is the weather today?');
      const state = createMockState({
        messages: [humanMessage],
        generatedTitle: undefined,
      });

      const aiResponse = new AIMessage('Weather Update');
      mockInvoke.mockResolvedValue(aiResponse);

      const result = await node.invoke(state, createMockConfig());

      expect(mockInvoke).toHaveBeenCalledWith([
        expect.any(SystemMessage),
        expect.any(HumanMessage),
      ]);
      expect(result.generatedTitle).toBe('Weather Update');
    });

    it('should return empty object if no human messages exist', async () => {
      const state = createMockState({
        messages: [],
        generatedTitle: undefined,
      });

      const result = await node.invoke(state, createMockConfig());

      expect(result).toEqual({});
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should trim and limit title to 100 characters', async () => {
      const humanMessage = new HumanMessage('Short question');
      const state = createMockState({
        messages: [humanMessage],
        generatedTitle: undefined,
      });

      const longTitle = 'A'.repeat(150);
      const aiResponse = new AIMessage(longTitle);
      mockInvoke.mockResolvedValue(aiResponse);

      const result = await node.invoke(state, createMockConfig());

      expect(result.generatedTitle).toBe('A'.repeat(100));
    });

    it('should handle string content from AI message', async () => {
      const humanMessage = new HumanMessage('Test question');
      const state = createMockState({
        messages: [humanMessage],
        generatedTitle: undefined,
      });

      const aiResponse = new AIMessage('  Generated Title  ');
      mockInvoke.mockResolvedValue(aiResponse);

      const result = await node.invoke(state, createMockConfig());

      expect(result.generatedTitle).toBe('Generated Title');
    });

    it('should handle non-string content from AI message', async () => {
      const humanMessage = new HumanMessage('Test question');
      const state = createMockState({
        messages: [humanMessage],
        generatedTitle: undefined,
      });

      const aiResponse = new AIMessage({ content: 'Title from object' });
      mockInvoke.mockResolvedValue(aiResponse);

      const result = await node.invoke(state, createMockConfig());

      expect(result.generatedTitle).toContain('Title from object');
    });

    it('should handle errors gracefully', async () => {
      const humanMessage = new HumanMessage('Test question');
      const state = createMockState({
        messages: [humanMessage],
        generatedTitle: undefined,
      });

      vi.spyOn(mockLlm, 'invoke').mockRejectedValue(new Error('LLM Error'));

      const result = await node.invoke(state, createMockConfig());

      expect(result).toEqual({});
    });

    it('should not generate title if there are only system messages', async () => {
      const systemMessage = new SystemMessage('System instruction');
      const state = createMockState({
        messages: [systemMessage],
        generatedTitle: undefined,
      });

      const result = await node.invoke(state, createMockConfig());

      expect(result).toEqual({});
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should find first human message even if there are other messages', async () => {
      const systemMessage = new SystemMessage('System message');
      const humanMessage = new HumanMessage('User question');
      const state = createMockState({
        messages: [systemMessage, humanMessage],
        generatedTitle: undefined,
      });

      const aiResponse = new AIMessage('Generated Title');
      mockInvoke.mockResolvedValue(aiResponse);

      const result = await node.invoke(state, createMockConfig());

      expect(result.generatedTitle).toBe('Generated Title');
      expect(mockInvoke).toHaveBeenCalledWith([
        expect.any(SystemMessage),
        expect.any(HumanMessage),
      ]);
    });
  });
});
