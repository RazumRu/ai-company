import type { BaseMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { isObject, isString } from 'lodash';

import type { MessageAdditionalKwargs } from '../../agents/agents.types';
import { extractTextFromResponseContent } from '../../agents/agents.utils';
import { MessageDto } from '../dto/graphs.dto';
import { MessageRole } from '../graphs.types';
import { parseStructuredContent } from '../graphs.utils';

/**
 * Interface for raw tool call structures from LangChain serialization
 */
interface RawToolCall {
  name?: string;
  args?: Record<string, unknown> | string;
  type?: string;
  id?: string;
  __title?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

@Injectable()
export class MessageTransformerService {
  /**
   * Transform BaseMessage array to MessageDto array
   */
  transformMessagesToDto(messages: BaseMessage[]): MessageDto[] {
    return messages
      .map((msg) => this.transformMessageToDto(msg))
      .filter((dto): dto is MessageDto => dto !== null);
  }

  /**
   * Transform a LangChain BaseMessage to MessageDto.
   *
   * Uses the constructor name to determine the message type (e.g. HumanMessage,
   * AIMessage, ToolMessage).  This replaces the previous SerializedBaseMessage
   * approach where the type was stored in a `.type` string field.
   */
  transformMessageToDto(msg: BaseMessage): MessageDto {
    const messageType =
      (msg.constructor as unknown as { name?: string })?.name ?? 'BaseMessage';
    const obj = msg as unknown as Record<string, unknown>;
    const rawAdditionalKwargs = obj['additional_kwargs'] as
      | MessageAdditionalKwargs
      | undefined;
    const additionalKwargs =
      this.normalizeAdditionalKwargs(rawAdditionalKwargs);
    const runId = (() => {
      const v =
        additionalKwargs?.__runId ??
        (additionalKwargs as unknown as { run_id?: unknown })?.run_id;
      return typeof v === 'string' && v.length > 0 ? v : null;
    })();
    const isAgentInstruction = Boolean(
      additionalKwargs?.__isAgentInstructionMessage ??
      (additionalKwargs as unknown as { isAgentInstructionMessage?: unknown })
        ?.isAgentInstructionMessage,
    );
    const contentStr = this.normalizeContent(obj['content']);

    switch (messageType) {
      case 'HumanMessage':
        if (isAgentInstruction) {
          return {
            role: MessageRole.AI,
            content: contentStr,
            additionalKwargs,
            runId,
          };
        }
        return {
          role: MessageRole.Human,
          content: contentStr,
          additionalKwargs,
          runId,
        };

      case 'SystemMessage':
        return {
          role: MessageRole.System,
          content: contentStr,
          additionalKwargs,
          runId,
        };

      case 'ChatMessage': {
        const role =
          typeof obj['role'] === 'string' ? (obj['role'] as string) : undefined;
        const reasoningId = (() => {
          const fromId =
            typeof obj['id'] === 'string' ? (obj['id'] as string) : undefined;
          if (fromId) {
            return fromId;
          }
          const raw = rawAdditionalKwargs as unknown as Record<string, unknown>;
          const v = raw?.__reasoningId ?? raw?.reasoningId;
          return typeof v === 'string' && v.length > 0 ? v : undefined;
        })();

        if (role === 'reasoning') {
          return {
            id: reasoningId,
            role: MessageRole.Reasoning,
            content: contentStr,
            additionalKwargs,
            runId,
          };
        }

        return {
          role: MessageRole.AI,
          content: contentStr,
          id: typeof obj['id'] === 'string' ? (obj['id'] as string) : undefined,
          additionalKwargs,
          runId,
        };
      }

      case 'AIMessageChunk':
      case 'AIMessage': {
        const toolCalls = this.mapToolCalls(
          Array.isArray(obj['tool_calls'])
            ? (obj['tool_calls'] as RawToolCall[])
            : [],
        );
        return {
          role: MessageRole.AI,
          content: contentStr,
          id: typeof obj['id'] === 'string' ? (obj['id'] as string) : undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          additionalKwargs,
          runId,
        };
      }

      case 'ToolMessage': {
        const toolName = (obj['name'] as string) || 'unknown';
        const toolCallId = (obj['tool_call_id'] as string) || '';
        const parsed = parseStructuredContent(obj['content']);
        const parsedRecord = Array.isArray(parsed)
          ? { data: parsed }
          : isObject(parsed)
            ? (parsed as Record<string, unknown>)
            : { message: parsed };
        const title =
          typeof additionalKwargs?.__title === 'string'
            ? additionalKwargs.__title
            : undefined;

        return {
          role: MessageRole.Tool,
          name: toolName,
          content: parsedRecord,
          toolCallId,
          title,
          additionalKwargs,
          runId,
        };
      }

      default:
        // Fallback for unknown message types - treat as system message
        return {
          role: MessageRole.System,
          content: contentStr,
          additionalKwargs,
          runId,
        };
    }
  }

  private normalizeContent(input: unknown): string {
    const flattened = extractTextFromResponseContent(input);
    if (flattened !== undefined) {
      return flattened;
    }
    return typeof input === 'string' ? input : JSON.stringify(input);
  }

  private normalizeAdditionalKwargs(
    v: unknown,
  ): Record<string, unknown> | undefined {
    const obj = isObject(v) ? (v as Record<string, unknown>) : undefined;
    if (!obj || !Object.keys(obj).length) {
      return undefined;
    }

    // Normalize legacy keys to the canonical `__*` camelCase format.
    // We keep provider/tool transport fields untouched.
    const normalized: Record<string, unknown> = { ...obj };

    const mapString = (legacyKey: string, nextKey: string): void => {
      if (typeof normalized[nextKey] === 'string' && normalized[nextKey]) {
        delete normalized[legacyKey];
        return;
      }
      const v = normalized[legacyKey];
      if (typeof v === 'string' && v) {
        normalized[nextKey] = v;
      }
      delete normalized[legacyKey];
    };

    const mapBool = (legacyKey: string, nextKey: string): void => {
      if (typeof normalized[nextKey] === 'boolean') {
        delete normalized[legacyKey];
        return;
      }
      const v = normalized[legacyKey];
      if (typeof v === 'boolean') {
        normalized[nextKey] = v;
      }
      delete normalized[legacyKey];
    };

    mapString('run_id', '__runId');
    mapString('thread_id', '__threadId');
    mapString('created_at', '__createdAt');
    mapString('reasoningId', '__reasoningId');

    mapBool('hideForLlm', '__hideForLlm');
    mapBool('hideForSummary', '__hideForSummary');
    mapBool('isAgentInstructionMessage', '__isAgentInstructionMessage');

    if (normalized['__tokenUsage'] === undefined && normalized['tokenUsage']) {
      normalized['__tokenUsage'] = normalized['tokenUsage'];
    }
    delete normalized['tokenUsage'];

    if (normalized['__context'] === undefined && normalized['context']) {
      normalized['__context'] = normalized['context'];
    }
    delete normalized['context'];

    return normalized;
  }

  private mapToolCalls(toolCalls: RawToolCall[]): {
    name: string;
    args: Record<string, unknown>;
    type: string;
    id: string;
    title?: string;
  }[] {
    return (toolCalls || [])
      .filter((tc) => isObject(tc))
      .map((tc) => {
        const title =
          typeof tc.__title === 'string' && tc.__title.length > 0
            ? tc.__title
            : undefined;
        if (isObject(tc.function)) {
          let args: Record<string, unknown> = {};
          const rawArgs = tc.function.arguments;
          if (isString(rawArgs)) {
            try {
              const parsed = JSON.parse(rawArgs) as unknown;
              args = isObject(parsed)
                ? (parsed as Record<string, unknown>)
                : {};
            } catch {
              args = {};
            }
          } else if (isObject(rawArgs)) {
            args = rawArgs;
          }
          const toolName = tc.function.name || '';
          return {
            name: toolName,
            args: args || {},
            type: tc.type || 'tool_call',
            id: tc.id || '',
            ...(title ? { title } : {}),
          };
        }

        let args: Record<string, unknown> = {};
        if (isString(tc.args)) {
          try {
            const parsed = JSON.parse(tc.args) as unknown;
            args = isObject(parsed) ? (parsed as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
        } else if (isObject(tc.args)) {
          args = tc.args;
        }

        const toolName = tc.name || '';
        return {
          name: toolName,
          args: args,
          type: tc.type || 'tool_call',
          id: tc.id || '',
          ...(title ? { title } : {}),
        };
      })
      .filter((tc) => tc.name);
  }
}
