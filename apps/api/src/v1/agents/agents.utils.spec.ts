import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import {
  buildReasoningMessage,
  cleanMessagesForLlm,
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

      expect(marked.additional_kwargs?.hideForLlm).toBe(true);
      expect(marked.content).toBe('Test message');
    });

    it('should preserve existing additional_kwargs', () => {
      const message = new SystemMessage('Test message');
      message.additional_kwargs = { custom: 'value' };
      const marked = markMessageHideForLlm(message);

      expect(marked.additional_kwargs?.hideForLlm).toBe(true);
      expect(marked.additional_kwargs?.custom).toBe('value');
    });

    it('should not mutate the original message', () => {
      const message = new SystemMessage('Test message');
      const marked = markMessageHideForLlm(message);

      expect(message.additional_kwargs?.hideForLlm).toBeUndefined();
      expect(marked.additional_kwargs?.hideForLlm).toBe(true);
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

      expect(updated.additional_kwargs?.run_id).toBe('test-run-123');
    });

    it('should not overwrite existing run_id', () => {
      const message = new HumanMessage('Test');
      message.additional_kwargs = { run_id: 'existing-run' };

      const config = {
        configurable: {
          run_id: 'new-run',
        },
      };

      const updated = updateMessageWithMetadata(message, config as any);

      expect(updated.additional_kwargs?.run_id).toBe('existing-run');
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
        expect(msg.additional_kwargs?.run_id).toBe('test-run-123');
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

      expect(updated.additional_kwargs?.hideForLlm).toBe(true);
      expect(updated.additional_kwargs?.run_id).toBe('test-run-123');
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
      expect(msg.additional_kwargs?.hideForLlm).toBe(true);
      expect(msg.additional_kwargs?.reasoningId).toBe('reasoning:parent-123');
    });
  });
});
