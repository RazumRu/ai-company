import {
  AIMessage,
  ChatMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import {
  buildReasoningMessage,
  cleanMessagesForLlm,
  convertChunkToMessage,
  extractTextFromResponseContent,
  filterMessagesForLlm,
  markMessageHideForLlm,
  prepareMessagesForLlm,
  updateMessagesListWithMetadata,
  updateMessageWithMetadata,
} from './agents.utils';

describe('agents.utils', () => {
  describe('markMessageHideForLlm', () => {
    it('should mark a message with hideForLlm flag', () => {
      const message = new SystemMessage('Test message');
      const marked = markMessageHideForLlm(message);

      expect(marked.additional_kwargs?.__hideForLlm).toBe(true);
      expect(marked.content).toBe('Test message');
    });

    it('should preserve existing additional_kwargs', () => {
      const message = new SystemMessage('Test message');
      message.additional_kwargs = { custom: 'value' };
      const marked = markMessageHideForLlm(message);

      expect(marked.additional_kwargs?.__hideForLlm).toBe(true);
      expect(marked.additional_kwargs?.custom).toBe('value');
    });

    it('should not mutate the original message', () => {
      const message = new SystemMessage('Test message');
      const marked = markMessageHideForLlm(message);

      expect(message.additional_kwargs?.__hideForLlm).toBeUndefined();
      expect(marked.additional_kwargs?.__hideForLlm).toBe(true);
    });
  });

  describe('filterMessagesForLlm', () => {
    it('should filter out messages with hideForLlm flag', () => {
      const messages = [
        new HumanMessage('User message'),
        markMessageHideForLlm(new SystemMessage('Summary message')),
        new AIMessage('Assistant message'),
      ];

      const filtered = filterMessagesForLlm(messages);

      expect(filtered).toHaveLength(2);
      expect(filtered[0]?.content).toBe('User message');
      expect(filtered[1]?.content).toBe('Assistant message');
    });

    it('should keep all messages if none have hideForLlm flag', () => {
      const messages = [
        new HumanMessage('User message'),
        new SystemMessage('System message'),
        new AIMessage('Assistant message'),
      ];

      const filtered = filterMessagesForLlm(messages);

      expect(filtered).toHaveLength(3);
    });

    it('should return empty array if all messages are hidden', () => {
      const messages = [
        markMessageHideForLlm(new HumanMessage('Hidden user message')),
        markMessageHideForLlm(new SystemMessage('Hidden system message')),
      ];

      const filtered = filterMessagesForLlm(messages);

      expect(filtered).toHaveLength(0);
    });

    it('should always filter out reasoning role messages (defense-in-depth)', () => {
      const messages = [
        new HumanMessage('User message'),
        new ChatMessage('Reasoning message', 'reasoning'),
        new AIMessage('Assistant message'),
      ];

      const filtered = filterMessagesForLlm(messages);

      expect(filtered).toHaveLength(2);
      expect(filtered[0]?.content).toBe('User message');
      expect(filtered[1]?.content).toBe('Assistant message');
    });

    it('should return empty array for empty input', () => {
      const filtered = filterMessagesForLlm([]);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('cleanMessagesForLlm', () => {
    it('should remove AI tool call messages that have missing tool results', () => {
      const toolCallId = 'call-1';
      const msgs = [
        new AIMessage({
          content: 'calling tool',
          tool_calls: [
            { id: toolCallId, name: 'tool', args: {}, type: 'tool_call' },
          ],
        }),
      ];

      const cleaned = cleanMessagesForLlm(msgs);
      expect(cleaned).toHaveLength(0);
    });

    it('should keep AI tool call messages when matching tool results exist', () => {
      const toolCallId = 'call-1';
      const msgs = [
        new AIMessage({
          content: 'calling tool',
          tool_calls: [
            { id: toolCallId, name: 'tool', args: {}, type: 'tool_call' },
          ],
        }),
        // ToolMessage in LangChain carries tool_call_id
        new ToolMessage({
          tool_call_id: toolCallId,
          name: 'tool',
          content: 'ok',
        }),
      ];

      const cleaned = cleanMessagesForLlm(msgs);
      expect(cleaned).toHaveLength(2);
    });

    it('should remove ToolMessages that do not have a matching tool call', () => {
      const msgs = [
        new HumanMessage('hi'),
        new ToolMessage({
          tool_call_id: 'call-orphan',
          name: 'tool',
          content: 'orphan result',
        }),
      ];

      const cleaned = cleanMessagesForLlm(msgs);
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]).toBeInstanceOf(HumanMessage);
    });

    it('should consider tool calls in additional_kwargs.tool_calls for cleaning', () => {
      const toolCallId = 'call-kw';
      const aiWithKwToolCall = new AIMessage({
        content: '',
        additional_kwargs: {
          tool_calls: [
            {
              id: toolCallId,
              type: 'function',
              function: { name: 'tool', arguments: '{}' },
            },
          ],
        },
      });

      const cleaned1 = cleanMessagesForLlm([aiWithKwToolCall]);
      expect(cleaned1).toHaveLength(0);

      const cleaned2 = cleanMessagesForLlm([
        aiWithKwToolCall,
        new ToolMessage({
          tool_call_id: toolCallId,
          name: 'tool',
          content: 'ok',
        }),
      ]);
      expect(cleaned2).toHaveLength(2);
    });

    it('should keep non-tool-calling AI messages unchanged', () => {
      const msgs = [new AIMessage('hello'), new HumanMessage('hi')];
      const cleaned = cleanMessagesForLlm(msgs);
      expect(cleaned).toHaveLength(2);
    });
  });

  describe('prepareMessagesForLlm', () => {
    it('should filter hideForLlm messages and then clean dangling tool calls', () => {
      const toolCallId = 'call-1';
      const msgs = [
        markMessageHideForLlm(new SystemMessage('hidden')),
        new AIMessage({
          content: 'calling tool',
          tool_calls: [
            { id: toolCallId, name: 'tool', args: {}, type: 'tool_call' },
          ],
        }),
      ];

      const prepared = prepareMessagesForLlm(msgs);
      expect(prepared).toHaveLength(0);
    });

    it('should strip ids + metadata and flatten structured AI content', () => {
      const ai = new AIMessage({
        content: [
          { type: 'text', text: 'Hello' },
          // This simulates responses-style content blocks where a provider may include non-text blocks.
          // We should not send structured blocks back to the model.
          { type: 'reasoning', reasoning: 'secret', summary: 'n/a' } as any,
          { type: 'text', text: 'World' },
        ] as any,
      });
      (ai as any).id = 'rs_123';
      (ai as any).response_metadata = { foo: 'bar' };
      (ai as any).usage_metadata = { input_tokens: 1 };
      ai.additional_kwargs = { __runId: 'run-1', __hideForLlm: false };

      const prepared = prepareMessagesForLlm([ai]);

      expect(prepared).toHaveLength(1);
      const out = prepared[0] as AIMessage;
      expect((out as any).id).toBeUndefined();
      expect((out as any).response_metadata).toEqual({});
      expect((out as any).usage_metadata).toBeUndefined();
      expect(out.additional_kwargs).toEqual({});
      expect(out.content).toBe('Hello\nWorld');
    });

    it('should preserve ToolMessage content and tool_call_id for LLM', () => {
      const toolCallId = 'call-123';
      const toolContent = 'Tool execution result';
      const msgs = [
        new HumanMessage('Run tool'),
        new AIMessage({
          content: 'calling tool',
          tool_calls: [
            {
              id: toolCallId,
              name: 'test_tool',
              args: { param: 'value' },
              type: 'tool_call',
            },
          ],
        }),
        new ToolMessage({
          tool_call_id: toolCallId,
          name: 'test_tool',
          content: toolContent,
          additional_kwargs: {
            __model: 'gpt-4',
            __tokenUsage: { totalTokens: 10 },
          },
        }),
      ];

      const prepared = prepareMessagesForLlm(msgs);

      expect(prepared).toHaveLength(3);
      const toolMsg = prepared[2] as ToolMessage;
      expect(toolMsg).toBeInstanceOf(ToolMessage);
      expect(toolMsg.tool_call_id).toBe(toolCallId);
      expect(toolMsg.name).toBe('test_tool');
      expect(toolMsg.content).toBe(toolContent);
      // additional_kwargs should be cleared for safety, but core properties must remain
      expect(toolMsg.additional_kwargs).toEqual({});
    });
  });

  describe('updateMessageWithMetadata', () => {
    it('should add run_id metadata to a message', () => {
      const message = new HumanMessage('Test');
      const config = {
        configurable: {
          run_id: 'test-run-123',
        },
      };

      const updated = updateMessageWithMetadata(message, config as any);

      expect(updated.additional_kwargs?.__runId).toBe('test-run-123');
    });

    it('should not overwrite existing run_id', () => {
      const message = new HumanMessage('Test');
      message.additional_kwargs = { __runId: 'existing-run' };

      const config = {
        configurable: {
          run_id: 'new-run',
        },
      };

      const updated = updateMessageWithMetadata(message, config as any);

      expect(updated.additional_kwargs?.__runId).toBe('existing-run');
    });
  });

  describe('extractTextFromResponseContent', () => {
    it('should flatten structured content arrays', () => {
      const result = extractTextFromResponseContent([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]);
      expect(result).toBe('Hello\nWorld');
    });

    it('should flatten stringified structured content', () => {
      const payload = JSON.stringify([{ type: 'text', text: 'Structured' }]);
      const result = extractTextFromResponseContent(payload);
      expect(result).toBe('Structured');
    });

    it('should trim plain string content', () => {
      const result = extractTextFromResponseContent('  plain text ');
      expect(result).toBe('plain text');
    });

    it('should return undefined when parsing fails', () => {
      expect(extractTextFromResponseContent({})).toBeUndefined();
    });
  });

  describe('updateMessagesListWithMetadata', () => {
    it('should add run_id metadata to all messages', () => {
      const messages = [
        new HumanMessage('Message 1'),
        new SystemMessage('Message 2'),
        new AIMessage('Message 3'),
      ];

      const config = {
        configurable: {
          run_id: 'test-run-123',
        },
      };

      const updated = updateMessagesListWithMetadata(messages, config as any);

      expect(updated).toHaveLength(3);
      updated.forEach((msg) => {
        expect(msg.additional_kwargs?.__runId).toBe('test-run-123');
      });
    });
  });

  describe('integration: hideForLlm with other metadata', () => {
    it('should preserve hideForLlm flag when updating metadata', () => {
      const message = markMessageHideForLlm(new SystemMessage('Test'));
      const config = {
        configurable: {
          run_id: 'test-run-123',
        },
      };

      const updated = updateMessageWithMetadata(message, config as any);

      expect(updated.additional_kwargs?.__hideForLlm).toBe(true);
      expect(updated.additional_kwargs?.__runId).toBe('test-run-123');
    });

    it('should filter hideForLlm messages even after metadata update', () => {
      const messages = [
        new HumanMessage('User message'),
        markMessageHideForLlm(new SystemMessage('Summary message')),
      ];

      const config = {
        configurable: {
          run_id: 'test-run-123',
        },
      };

      const updated = updateMessagesListWithMetadata(messages, config as any);
      const filtered = filterMessagesForLlm(updated);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.content).toBe('User message');
    });
  });

  describe('buildReasoningMessage', () => {
    it('should prefix id with reasoning namespace when parent id provided', () => {
      const msg = buildReasoningMessage('reasoning text', 'parent-123');

      expect(msg.role).toBe('reasoning');
      expect(msg.id).toBe('reasoning:parent-123');
      expect(msg.additional_kwargs?.__hideForLlm).toBe(true);
      expect(msg.additional_kwargs?.__reasoningId).toBe('reasoning:parent-123');
    });
  });

  describe('convertChunkToMessage', () => {
    it('should extract tool calls from additional_kwargs.tool_calls (OpenAI shape)', () => {
      const chunk = {
        id: 'run-1',
        name: undefined,
        content: '',
        contentBlocks: [],
        response_metadata: {},
        tool_calls: [],
        invalid_tool_calls: [],
        usage_metadata: undefined,
        additional_kwargs: {
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'finish',
                arguments: '{"purpose":"x","message":"y","needsMoreInfo":true}',
              },
              index: 0,
            },
          ],
        },
      } as any;

      const msg = convertChunkToMessage(chunk);
      const toolCalls = msg.tool_calls ?? [];
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]?.name).toBe('finish');
      expect(toolCalls[0]?.args).toEqual({
        purpose: 'x',
        message: 'y',
        needsMoreInfo: true,
      });
    });
  });
});
