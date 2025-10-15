import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { isObject, isString } from 'lodash';

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
  transformMessageToDto(msg: BaseMessage): MessageDto {
    const additionalKwargs = this.normalizeAdditionalKwargs(
      msg.additional_kwargs,
    );
    const contentStr = this.normalizeContent(msg.content);

    if (msg instanceof HumanMessage) {
      return { role: 'human', content: contentStr, additionalKwargs };
    }

    if (msg instanceof SystemMessage) {
      return { role: 'system', content: contentStr, additionalKwargs };
    }

    if (msg instanceof AIMessage) {
      const toolCalls = this.mapToolCalls(msg.tool_calls || []);
      return {
        role: 'ai',
        content: contentStr,
        id: msg.id,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        additionalKwargs,
      };
    }

    if (msg instanceof ToolMessage) {
      const toolName = msg.name || 'unknown';
      const toolCallId = msg.tool_call_id || '';
      const parsed = this.parseToolContent(msg.content);

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

    // Fallback for unknown message types - treat as system message
    return { role: 'system', content: contentStr, additionalKwargs };
  }

  private normalizeContent(input: unknown): string {
    return typeof input === 'string' ? input : JSON.stringify(input);
  }

  private parseToolContent(input: unknown): Record<string, unknown> {
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch {
        return { raw: input };
      }
    }
    if (isObject(input)) return input as Record<string, unknown>;
    return { raw: input };
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
}
