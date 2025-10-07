import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

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
    this.logger?.debug('manual-trigger.start');
    this.status = TriggerStatus.LISTENING;
  }

  /**
   * Stop the trigger
   */
  async stop(): Promise<void> {
    this.logger?.debug('manual-trigger.stop');
    this.status = TriggerStatus.DESTROYED;
  }

  /**
   * Manually trigger the agent with messages
   */
  async trigger(messages: string[]): Promise<AgentOutput> {
    this.logger?.debug('manual-trigger.trigger', {
      messageCount: messages.length,
      status: this.status,
    });

    if (!this.isStarted) {
      throw new Error(
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

    const result = await this.handleTriggerEvent(event, {});

    this.logger?.debug('manual-trigger.trigger.complete');
    return result;
  }

  /**
   * Convert payload to human messages
   */
  protected convertPayloadToMessages(
    payload: ManualTriggerPayload,
  ): HumanMessage[] {
    this.logger?.debug('manual-trigger.convert-payload', {
      payloadMessageCount: payload.messages.length,
    });
    return payload.messages.map((msg) => new HumanMessage(msg));
  }
}
