import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import {
  castArray,
  compact,
  flattenDeep,
  get,
  isArray,
  isObject,
  isString,
} from 'lodash';
import { JsonObject } from 'type-fest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  ICheckpointerNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface ICheckpointerEnrichedNotification
  extends IEnrichedNotification<ICheckpointerNotification['data']> {
  type: EnrichedNotificationEvent.Checkpointer;
}

export interface ICheckpointerMessageEnrichedNotification
  extends IEnrichedNotification<{
    content: string;
    role: string;
    [key: string]: unknown;
  }> {
  type: EnrichedNotificationEvent.CheckpointerMessage;
  nodeId: string;
  threadId: string;
}

export interface ICheckpointerToolCallEnrichedNotification
  extends IEnrichedNotification<{
    name: string;
    args: unknown;
    id?: string;
    [key: string]: unknown;
  }> {
  type: EnrichedNotificationEvent.CheckpointerToolCall;
  nodeId: string;
  threadId: string;
}

type CheckpointerEnrichedNotification =
  | ICheckpointerEnrichedNotification
  | ICheckpointerMessageEnrichedNotification
  | ICheckpointerToolCallEnrichedNotification;

@Injectable()
export class CheckpointerNotificationHandler extends BaseNotificationHandler<CheckpointerEnrichedNotification> {
  readonly pattern = NotificationEvent.Checkpointer;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: ICheckpointerNotification,
  ): Promise<CheckpointerEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);
    const out: CheckpointerEnrichedNotification[] = [];

    const values = this.collectValues(event);

    for (const v of values) {
      const msg = this.parseMessage(v);
      if (msg) {
        out.push({
          type: EnrichedNotificationEvent.CheckpointerMessage,
          graphId: event.graphId,
          ownerId,
          nodeId: event.nodeId,
          threadId: event.threadId,
          data: {
            content: msg.content,
            role: msg.role,
            ...(msg.raw as JsonObject),
          },
        });
      }
      const tcs = this.extractToolCalls(v);
      for (const tc of tcs) {
        out.push({
          type: EnrichedNotificationEvent.CheckpointerToolCall,
          graphId: event.graphId,
          ownerId,
          nodeId: event.nodeId,
          threadId: event.threadId,
          data: { ...tc.raw, name: tc.name, args: tc.args, id: tc.id },
        });
      }
    }

    if (out.length === 0) {
      out.push({
        ...event,
        type: EnrichedNotificationEvent.Checkpointer,
        ownerId,
      });
    }

    return out;
  }

  private collectValues(event: ICheckpointerNotification): unknown[] {
    if (event.data.action === 'put') {
      const msgs = castArray(
        get(event, 'data.checkpoint.channel_values.messages', []),
      );
      return compact(flattenDeep(msgs.map((m) => this.expandItems(m))));
    }

    if (event.data.action === 'putWrites') {
      const writes = castArray(get(event, 'data.writes', []));
      const values = writes.map((w) => this.unwrapWriteValue(w));
      return compact(flattenDeep(values.map((v) => this.expandItems(v))));
    }

    return [];
  }

  private unwrapWriteValue(write: unknown): unknown {
    if (isArray(write) && write.length >= 2) {
      return write[1];
    }
    if (isObject(write) && 'value' in (write as JsonObject)) {
      return (write as JsonObject).value;
    }
    return write;
  }

  private expandItems(v: unknown): unknown[] {
    if (isObject(v) && isArray((v as JsonObject).items)) {
      return compact((v as JsonObject).items as unknown[]);
    }
    return compact([v]);
  }

  private parseMessage(
    raw: unknown,
  ): { content: string; role: string; raw: unknown } | null {
    if (!isObject(raw)) {
      return null;
    }
    const content = isString(get(raw as JsonObject, 'content'))
      ? (get(raw as JsonObject, 'content') as string)
      : isString(get(raw as JsonObject, 'lc_kwargs.content'))
        ? (get(raw as JsonObject, 'lc_kwargs.content') as string)
        : '';
    const role = isString(get(raw as JsonObject, 'role'))
      ? (get(raw as JsonObject, 'role') as string)
      : isString(get(raw as JsonObject, 'type'))
        ? (get(raw as JsonObject, 'type') as string)
        : isString(get(raw as JsonObject, 'lc_kwargs.type'))
          ? (get(raw as JsonObject, 'lc_kwargs.type') as string)
          : 'unknown';
    if (!content && role === 'unknown') {
      return null;
    }
    return { content, role, raw };
  }

  private extractToolCalls(
    raw: unknown,
  ): { name: string; args: unknown; id?: string; raw: JsonObject }[] {
    if (!isObject(raw)) {
      return [];
    }
    const direct = castArray(
      get(raw as JsonObject, 'tool_calls', []) as unknown[],
    );
    const add = castArray(
      get(raw as JsonObject, 'additional_kwargs.tool_calls', []) as unknown[],
    );
    const lc = castArray(
      get(
        raw as JsonObject,
        'lc_kwargs.additional_kwargs.tool_calls',
        [],
      ) as unknown[],
    );
    const candidates = compact(flattenDeep([direct, add, lc])) as unknown[];

    const out: { name: string; args: unknown; id?: string; raw: JsonObject }[] =
      [];
    for (const tc of candidates) {
      if (!isObject(tc)) {
        continue;
      }
      const obj = tc as JsonObject;
      if (isObject(obj.function)) {
        const name = String(get(obj, 'function.name', ''));
        let args: unknown = get(obj, 'function.arguments');
        if (isString(args)) {
          try {
            args = JSON.parse(args as string);
          } catch {
            //
          }
        }
        if (name) {
          out.push({ name, args, id: obj.id as string | undefined, raw: obj });
        }
        continue;
      }
      if (isString(obj.name) && 'args' in obj) {
        out.push({
          name: obj.name as string,
          args: (obj as JsonObject).args,
          id: obj.id as string | undefined,
          raw: obj,
        });
      }
    }
    return out;
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }
    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }
    this.graphOwnerCache.set(graphId, graph.createdBy);
    return graph.createdBy;
  }
}
