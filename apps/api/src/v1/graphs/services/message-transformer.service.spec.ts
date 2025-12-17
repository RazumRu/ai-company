import { beforeEach, describe, expect, it } from 'vitest';

import type { SerializedBaseMessage } from '../../notifications/notifications.types';
import {
  AIMessageDto,
  HumanMessageDto,
  ReasoningMessageDto,
  ShellToolMessageDto,
  SystemMessageDto,
  ToolMessageDto,
} from '../dto/graphs.dto';
import { MessageTransformerService } from './message-transformer.service';

describe('MessageTransformerService', () => {
  let service: MessageTransformerService;

  const msg = (
    m: Omit<SerializedBaseMessage, '__serialized'>,
  ): SerializedBaseMessage => ({
    __serialized: true,
    ...m,
  });

  beforeEach(() => {
    service = new MessageTransformerService();
  });

  describe('transformMessageToDto', () => {
    it('should transform human message', () => {
      const m = msg({ type: 'HumanMessage', content: 'Hello, world!' });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'human',
        content: 'Hello, world!',
        additionalKwargs: undefined,
        runId: null,
      } as HumanMessageDto);
    });

    it('should convert agent instruction human messages into ai responses', () => {
      const m = msg({
        type: 'HumanMessage',
        content: 'Please help the user with the deployment.',
        additional_kwargs: {
          isAgentInstructionMessage: true,
          run_id: 'run-1',
        },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'ai',
        content: 'Please help the user with the deployment.',
        rawContent: 'Please help the user with the deployment.',
        id: undefined,
        toolCalls: undefined,
        runId: 'run-1',
        additionalKwargs: expect.objectContaining({
          isAgentInstructionMessage: true,
          run_id: 'run-1',
        }),
      } as AIMessageDto);
    });

    it('should transform system message', () => {
      const m = msg({
        type: 'SystemMessage',
        content: 'System instruction',
        additional_kwargs: { context: 'test', run_id: 'run-1' },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'system',
        content: 'System instruction',
        runId: 'run-1',
        additionalKwargs: { context: 'test', run_id: 'run-1' },
      } as SystemMessageDto);
    });

    it('should transform AI message without tool calls', () => {
      const m = msg({
        type: 'AIMessage',
        content: 'AI response',
        id: 'msg-123',
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'ai',
        content: 'AI response',
        rawContent: 'AI response',
        id: 'msg-123',
        toolCalls: undefined,
        additionalKwargs: undefined,
        runId: null,
      } as AIMessageDto);
    });

    it('should transform AI message with tool calls', () => {
      const m = msg({
        type: 'AIMessage',
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
        additional_kwargs: { run_id: 'run-1' },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'ai',
        content: 'Calling tools',
        rawContent: 'Calling tools',
        id: 'msg-456',
        toolCalls: [
          {
            name: 'get_weather',
            args: { city: 'SF' },
            type: 'tool_call',
            id: 'call-1',
          },
        ],
        runId: 'run-1',
        additionalKwargs: { run_id: 'run-1' },
      } as AIMessageDto);
    });

    it('should pass through __title metadata for tool call requests', () => {
      const m = msg({
        type: 'AIMessage',
        content: 'Calling tools',
        id: 'msg-req-1',
        tool_calls: [
          {
            name: 'shell',
            args: { purpose: 'List repo root', cmd: 'ls' },
            type: 'tool_call',
            id: 'call-shell-req-1',
            __title: 'List repo root',
          },
          {
            name: 'web_search',
            args: { query: 'NestJS interceptors', searchDepth: 'basic' },
            type: 'tool_call',
            id: 'call-web-req-1',
            __title: 'Search in internet: NestJS interceptors',
          },
        ],
      });

      const result = service.transformMessageToDto(m) as AIMessageDto;

      expect(result.role).toBe('ai');
      expect(result.toolCalls).toEqual([
        {
          name: 'shell',
          args: { purpose: 'List repo root', cmd: 'ls' },
          type: 'tool_call',
          id: 'call-shell-req-1',
          title: 'List repo root',
        },
        {
          name: 'web_search',
          args: { query: 'NestJS interceptors', searchDepth: 'basic' },
          type: 'tool_call',
          id: 'call-web-req-1',
          title: 'Search in internet: NestJS interceptors',
        },
      ]);
    });

    it('should transform reasoning chat message', () => {
      const m = msg({
        type: 'ChatMessage',
        role: 'reasoning',
        content: 'Detailed reasoning steps',
        additional_kwargs: { hideForLlm: true },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'reasoning',
        content: 'Detailed reasoning steps',
        additionalKwargs: { hideForLlm: true },
        runId: null,
      } as ReasoningMessageDto);
    });

    it('should preserve reasoning id for reasoning messages', () => {
      const m = msg({
        type: 'ChatMessage',
        role: 'reasoning',
        content: 'Serialized reasoning',
        additional_kwargs: {
          hideForLlm: true,
          reasoningId: 'reasoning:parent-42',
        },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'reasoning',
        content: 'Serialized reasoning',
        id: 'reasoning:parent-42',
        runId: null,
        additionalKwargs: {
          hideForLlm: true,
          reasoningId: 'reasoning:parent-42',
        },
      } as ReasoningMessageDto);
    });

    it('should transform tool message', () => {
      const m = msg({
        type: 'ToolMessage',
        content: '{"result": "success"}',
        name: 'web_search',
        tool_call_id: 'call-789',
        additional_kwargs: {
          __title: 'Search in internet: cats',
          run_id: 'run-1',
        },
      });

      const result = service.transformMessageToDto(m);

      expect(result).toEqual({
        role: 'tool',
        name: 'web_search',
        content: { result: 'success' },
        toolCallId: 'call-789',
        title: 'Search in internet: cats',
        runId: 'run-1',
        additionalKwargs: {
          __title: 'Search in internet: cats',
          run_id: 'run-1',
        },
      } as ToolMessageDto);
    });

    it('should transform shell tool message', () => {
      const m = msg({
        type: 'ToolMessage',
        content: JSON.stringify({
          exitCode: 0,
          stdout: 'Success',
          stderr: '',
          cmd: 'echo test',
        }),
        name: 'shell',
        tool_call_id: 'call-shell-1',
        additional_kwargs: { run_id: 'run-1' },
      });

      const result = service.transformMessageToDto(m);

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
        runId: 'run-1',
        additionalKwargs: { run_id: 'run-1' },
      } as ShellToolMessageDto);
    });

    it('should handle malformed tool content', () => {
      const m = msg({
        type: 'ToolMessage',
        content: 'not valid json',
        name: 'test_tool',
        tool_call_id: 'call-1',
      });

      const result = service.transformMessageToDto(m) as ToolMessageDto;

      expect(result.content).toEqual({ message: 'not valid json' });
      expect(result.runId).toBeNull();
    });
  });

  describe('transformMessagesToDto', () => {
    it('should transform multiple SerializedBaseMessage to MessageDto array', () => {
      const messages = [
        msg({ type: 'HumanMessage', content: 'First message' }),
        msg({ type: 'AIMessage', content: 'Second message', id: 'msg-2' }),
      ];

      const results = service.transformMessagesToDto(messages);

      expect(results).toHaveLength(2);
      expect(results[0]?.role).toBe('human');
      expect(results[0]?.content).toBe('First message');
      expect(results[1]?.role).toBe('ai');
      expect(results[1]?.content).toBe('Second message');
    });

    it('should handle empty array', () => {
      const results = service.transformMessagesToDto([]);
      expect(results).toEqual([]);
    });

    it('should handle messages with tool calls', () => {
      const messages = [
        msg({
          type: 'AIMessage',
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
