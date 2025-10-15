import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  AIMessageDto,
  HumanMessageDto,
  ShellToolMessageDto,
  SystemMessageDto,
  ToolMessageDto,
} from '../dto/graphs.dto';
import { MessageTransformerService } from './message-transformer.service';

describe('MessageTransformerService', () => {
  let service: MessageTransformerService;

  beforeEach(() => {
    service = new MessageTransformerService();
  });

  describe('transformMessageToDto', () => {
    it('should transform human message', () => {
      const msg = new HumanMessage('Hello, world!');

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'human',
        content: 'Hello, world!',
        additionalKwargs: undefined,
      } as HumanMessageDto);
    });

    it('should transform system message', () => {
      const msg = new SystemMessage({
        content: 'System instruction',
        additional_kwargs: { context: 'test' },
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'system',
        content: 'System instruction',
        additionalKwargs: { context: 'test' },
      } as SystemMessageDto);
    });

    it('should transform AI message without tool calls', () => {
      const msg = new AIMessage({
        content: 'AI response',
        id: 'msg-123',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'ai',
        content: 'AI response',
        id: 'msg-123',
        toolCalls: undefined,
        additionalKwargs: undefined,
      } as AIMessageDto);
    });

    it('should transform AI message with tool calls', () => {
      const msg = new AIMessage({
        content: 'Calling tools',
        id: 'msg-456',
        tool_calls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'ai',
        content: 'Calling tools',
        id: 'msg-456',
        toolCalls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
        additionalKwargs: undefined,
      } as AIMessageDto);
    });

    it('should transform tool message', () => {
      const msg = new ToolMessage({
        content: '{"result": "success"}',
        name: 'web_search',
        tool_call_id: 'call-789',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'tool',
        name: 'web_search',
        content: { result: 'success' },
        toolCallId: 'call-789',
        additionalKwargs: undefined,
      } as ToolMessageDto);
    });

    it('should transform shell tool message', () => {
      const msg = new ToolMessage({
        content: JSON.stringify({
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          cmd: 'echo test',
        }),
        name: 'shell',
        tool_call_id: 'call-shell-1',
      });

      const result = service.transformMessageToDto(msg);

      expect(result).toEqual({
        role: 'tool-shell',
        name: 'shell',
        content: {
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          cmd: 'echo test',
        },
        toolCallId: 'call-shell-1',
        additionalKwargs: undefined,
      } as ShellToolMessageDto);
    });

    it('should handle malformed tool content', () => {
      const msg = new ToolMessage({
        content: 'not valid json',
        name: 'test_tool',
        tool_call_id: 'call-1',
      });

      const result = service.transformMessageToDto(msg) as ToolMessageDto;

      expect(result.content).toEqual({ raw: 'not valid json' });
    });
  });

  describe('transformMessagesToDto', () => {
    it('should transform multiple BaseMessages to MessageDto array', () => {
      const messages = [
        new HumanMessage('First message'),
        new AIMessage({
          content: 'Second message',
          id: 'msg-2',
        }),
      ];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(2);
      expect(results[0]?.role).toBe('human');
      expect(results[0]?.content).toBe('First message');
      expect(results[1]?.role).toBe('ai');
      expect(results[1]?.content).toBe('Second message');
    });

    it('should filter out null results', () => {
      const messages = [new HumanMessage('Valid message')];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(1);
      expect(results[0]?.content).toBe('Valid message');
    });

    it('should handle empty array', () => {
      const results = service.transformMessagesToDto([]);

      expect(results).toEqual([]);
    });

    it('should handle messages with tool calls', () => {
      const messages = [
        new AIMessage({
          content: 'Using tools',
          id: 'msg-1',
          tool_calls: [
            {
              name: 'get_weather',
              args: { city: 'SF' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
        }),
      ];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(1);
      expect(results[0]?.role).toBe('ai');
      if (results[0] && 'toolCalls' in results[0] && results[0].toolCalls) {
        expect(results[0].toolCalls).toHaveLength(1);
        expect(results[0].toolCalls[0]?.name).toBe('get_weather');
      }
    });
  });
});
