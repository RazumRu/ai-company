import { Injectable } from '@nestjs/common';
import { isObject, isString } from 'lodash';

import { extractTextFromResponseContent } from '../../agents/agents.utils';
import type { SerializedBaseMessage } from '../../notifications/notifications.types';
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
   * Transform SerializedBaseMessage array to MessageDto array
   */
  transformMessagesToDto(messages: SerializedBaseMessage[]): MessageDto[] {
    return messages
      .map((msg) => this.transformMessageToDto(msg))
      .filter((dto): dto is MessageDto => dto !== null);
  }

  /**
   * Transform a serialized message to MessageDto
   */
  transformMessageToDto(msg: SerializedBaseMessage): MessageDto {
    const messageType = msg.type;
    const rawAdditionalKwargs = msg.additional_kwargs;
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
    const contentStr = this.normalizeContent(msg.content);

    switch (messageType) {
      case 'HumanMessage':
        if (isAgentInstruction) {
          return {
            role: MessageRole.AI,
            content: contentStr,
            rawContent: msg.content,
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
        const role = typeof msg.role === 'string' ? msg.role : undefined;
        const reasoningId = (() => {
          const fromId = typeof msg.id === 'string' ? msg.id : undefined;
          if (fromId) return fromId;
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
          rawContent: msg.content,
          id: typeof msg.id === 'string' ? msg.id : undefined,
          additionalKwargs,
          runId,
        };
      }

      case 'AIMessageChunk':
      case 'AIMessage': {
        const toolCalls = this.mapToolCalls(
          Array.isArray(msg.tool_calls)
            ? (msg.tool_calls as RawToolCall[])
            : [],
        );
        return {
          role: MessageRole.AI,
          content: contentStr,
          rawContent: msg.content,
          id: typeof msg.id === 'string' ? msg.id : undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          additionalKwargs,
          runId,
        };
      }

      case 'ToolMessage': {
        const toolName = msg.name || 'unknown';
        const toolCallId = msg.tool_call_id || '';
        const parsed = parseStructuredContent(msg.content);
        const parsedRecord = isObject(parsed)
          ? (parsed as Record<string, unknown>)
          : Array.isArray(parsed)
            ? { data: parsed }
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
    if (!obj || !Object.keys(obj).length) return undefined;

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
    mapBool('isReportingMessage', '__isReportingMessage');

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
