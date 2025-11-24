import {
  AIMessage,
  BaseMessage,
  ChatMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { isObject, isString } from 'lodash';

import { extractTextFromResponseContent } from '../../agents/agents.utils';
import { MessageDto } from '../dto/graphs.dto';

/**
 * Interface for raw tool call structures from LangChain serialization
 */
interface RawToolCall {
  name?: string;
  args?: Record<string, unknown> | string;
  type?: string;
  id?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

/**
 * Interface for LangChain serialized message format
 */
interface SerializedMessage {
  lc: number;
  type: string;
  id: string[];
  kwargs: Record<string, unknown>;
}

@Injectable()
export class MessageTransformerService {
  /**
   * Transform multiple BaseMessages to MessageDto array
   * This is the primary method for transforming checkpoint messages
   */
  transformMessagesToDto(messages: BaseMessage[]): MessageDto[] {
    return messages
      .map((msg) => this.transformMessageToDto(msg))
      .filter((dto): dto is MessageDto => dto !== null);
  }

  /**
   * Transform a LangChain BaseMessage to MessageDto
   */
  transformMessageToDto(msg: BaseMessage | SerializedMessage): MessageDto {
    // Handle serialized LangChain messages (with lc, type, id, kwargs structure)
    const isInstance = !this.isSerializedMessage(msg);
    const messageType = isInstance
      ? (msg as BaseMessage).constructor.name
      : msg.id[2];
    const msgBody = isInstance ? msg : msg.kwargs;
    const rawAdditionalKwargs = (msgBody as {
      additional_kwargs?: Record<string, unknown>;
    }).additional_kwargs;
    const additionalKwargs =
      this.normalizeAdditionalKwargs(rawAdditionalKwargs);
    const contentStr = this.normalizeContent(msgBody.content);

    switch (messageType) {
      case 'HumanMessage':
        return { role: 'human', content: contentStr, additionalKwargs };

      case 'SystemMessage':
        return { role: 'system', content: contentStr, additionalKwargs };

      case 'ChatMessage': {
        const m = <ChatMessage>(<unknown>msgBody);
        const reasoningId =
          (m.id as string | undefined) ||
          ((rawAdditionalKwargs?.reasoningId as string) || undefined);

        if (m.role === 'reasoning') {
          return {
            id: reasoningId,
            role: 'reasoning',
            content: contentStr,
            additionalKwargs,
          };
        }

        return {
          role: 'ai',
          content: contentStr,
          rawContent: m.content,
          id: (m.id as string | undefined) || undefined,
          additionalKwargs,
        };
      }

      case 'AIMessageChunk':
      case 'AIMessage': {
        const m = <AIMessage>(<unknown>msgBody);
        const toolCalls = this.mapToolCalls(
          (m.tool_calls as RawToolCall[]) || [],
        );
        return {
          role: 'ai',
          content: contentStr,
          rawContent: m.content,
          id: m.id as string,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          additionalKwargs,
        };
      }

      case 'ToolMessage': {
        const m = <ToolMessage>(<unknown>msgBody);
        const toolName = (m.name as string) || 'unknown';
        const toolCallId = (m.tool_call_id as string) || '';
        const parsed = this.parseToolContent(m.content);

        if (toolName === 'shell') {
          return {
            role: 'tool-shell',
            name: toolName,
            content: parsed as {
              exitCode: number;
              stdout: string;
              stderr: string;
              cmd: string;
              fail?: boolean;
            },
            toolCallId,
            additionalKwargs,
          };
        }

        return {
          role: 'tool',
          name: toolName,
          content: parsed,
          toolCallId,
          additionalKwargs,
        };
      }

      default:
        // Fallback for unknown message types - treat as system message
        return { role: 'system', content: contentStr, additionalKwargs };
    }
  }

  private normalizeContent(input: unknown): string {
    const flattened = extractTextFromResponseContent(input);
    if (flattened !== undefined) {
      return flattened;
    }
    return typeof input === 'string' ? input : JSON.stringify(input);
  }

  private parseToolContent(input: unknown): Record<string, unknown> {
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch {
        return { message: input };
      }
    }
    if (isObject(input)) return input as Record<string, unknown>;
    return { message: input };
  }

  private normalizeAdditionalKwargs(
    v: unknown,
  ): Record<string, unknown> | undefined {
    const obj = isObject(v) ? (v as Record<string, unknown>) : undefined;
    if (obj && Object.keys(obj).length) return obj;
    return undefined;
  }

  private mapToolCalls(toolCalls: RawToolCall[]): {
    name: string;
    args: Record<string, unknown>;
    type: string;
    id: string;
  }[] {
    return (toolCalls || [])
      .filter((tc) => isObject(tc))
      .map((tc) => {
        if (isObject(tc.function)) {
          let args: Record<string, unknown> = {};
          const rawArgs = tc.function.arguments;
          if (isString(rawArgs)) {
            try {
              args = JSON.parse(rawArgs);
            } catch {
              args = {};
            }
          } else if (isObject(rawArgs)) {
            args = rawArgs as Record<string, unknown>;
          }
          return {
            name: tc.function.name || '',
            args: args || {},
            type: tc.type || 'tool_call',
            id: tc.id || '',
          };
        }

        let args: Record<string, unknown> = {};
        if (isString(tc.args)) {
          try {
            args = JSON.parse(tc.args);
          } catch {
            args = {};
          }
        } else if (isObject(tc.args)) {
          args = tc.args as Record<string, unknown>;
        }

        return {
          name: tc.name || '',
          args: args,
          type: tc.type || 'tool_call',
          id: tc.id || '',
        };
      })
      .filter((tc) => tc.name);
  }

  /**
   * Check if a message is in LangChain serialized format
   */
  private isSerializedMessage(
    msg: BaseMessage | SerializedMessage,
  ): msg is SerializedMessage {
    return (
      isObject(msg) &&
      'lc' in msg &&
      msg.lc === 1 &&
      'type' in msg &&
      msg.type === 'constructor' &&
      'id' in msg &&
      Array.isArray(msg.id) &&
      msg.id.length >= 2 &&
      msg.id[0] === 'langchain_core' &&
      msg.id[1] === 'messages' &&
      'kwargs' in msg &&
      isObject(msg.kwargs)
    );
  }
}
