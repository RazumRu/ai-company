import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException, DefaultLogger } from '@packages/common';

import { AgentOutput } from '../../agents/services/agents/base-agent';
import { TriggerEvent, TriggerStatus } from '../agent-triggers.types';
import { BaseTrigger } from './base-trigger';

/**
 * Manual trigger payload
 */
export interface ManualTriggerPayload {
  messages: string[];
}

/**
 * Manual trigger
 * Allows manual invocation by sending messages directly
 */
@Injectable({ scope: Scope.TRANSIENT })
export class ManualTrigger extends BaseTrigger<unknown, ManualTriggerPayload> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  /**
   * Start the trigger
   */
  async start(): Promise<void> {
    try {
      this.status = TriggerStatus.LISTENING;
      // Emit start event
      this.emit({ type: 'start', data: { config: {} } });
    } catch (error) {
      // Emit start event with error
      this.emit({ type: 'start', data: { config: {}, error } });
      throw error;
    }
  }

  /**
   * Stop the trigger
   */
  async stop(): Promise<void> {
    try {
      this.status = TriggerStatus.DESTROYED;
      // Emit stop event
      this.emit({ type: 'stop', data: {} });
    } catch (error) {
      // Emit stop event with error
      this.emit({ type: 'stop', data: { error } });
      throw error;
    }
  }

  /**
   * Manually trigger the agent with messages
   */
  async trigger(messages: string[]): Promise<AgentOutput> {
    if (!this.isStarted) {
      throw new BadRequestException(
        undefined,
        `Trigger is not in listening state. Current status: ${this.status}`,
      );
    }

    const event: TriggerEvent<ManualTriggerPayload> = {
      triggerId: 'manual-trigger',
      timestamp: new Date(),
      payload: {
        messages,
      },
    };

    try {
      const result = await this.handleTriggerEvent(event, {});
      // Emit invoke event with result
      this.emit({
        type: 'invoke',
        data: {
          messages: event.payload.messages.map((msg) => new HumanMessage(msg)),
          config: {},
          result,
        },
      });
      return result;
    } catch (error) {
      // Emit invoke event with error
      this.emit({
        type: 'invoke',
        data: {
          messages: event.payload.messages.map((msg) => new HumanMessage(msg)),
          config: {},
          error,
        },
      });
      throw error;
    }
  }

  /**
   * Convert payload to human messages
   */
  protected convertPayloadToMessages(
    payload: ManualTriggerPayload,
  ): HumanMessage[] {
    return payload.messages.map((msg) => new HumanMessage(msg));
  }
}
