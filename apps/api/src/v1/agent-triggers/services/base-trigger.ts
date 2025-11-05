import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { EventEmitter } from 'events';

import { AgentOutput } from '../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { TriggerEvent, TriggerStatus } from '../agent-triggers.types';

export type TriggerStartEvent = {
  config: unknown;
  error?: unknown;
};

export type TriggerStopEvent = {
  error?: unknown;
};

export type TriggerInvokeEvent = {
  messages: HumanMessage[];
  config: RunnableConfig<BaseAgentConfigurable>;
  result?: AgentOutput;
  error?: unknown;
};

export type TriggerEventType =
  | { type: 'start'; data: TriggerStartEvent }
  | { type: 'stop'; data: TriggerStopEvent }
  | { type: 'invoke'; data: TriggerInvokeEvent };

/**
 * Base trigger class
 * All triggers must extend this class
 */
export abstract class BaseTrigger<TConfig = unknown, TPayload = unknown> {
  protected status: TriggerStatus = TriggerStatus.IDLE;
  protected eventEmitter = new EventEmitter();
  public invokeAgent!: (
    messages: HumanMessage[],
    config: RunnableConfig<BaseAgentConfigurable>,
  ) => Promise<AgentOutput>;

  constructor(protected readonly logger?: DefaultLogger) {}

  /**
   * Subscribe to trigger events
   * Returns an unsubscriber function
   */
  subscribe(callback: (event: TriggerEventType) => Promise<void>): () => void {
    const handler = (event: TriggerEventType) => callback(event);

    this.eventEmitter.on('event', handler);

    return () => {
      this.eventEmitter.off('event', handler);
    };
  }

  /**
   * Emit trigger events
   */
  protected emit(event: TriggerEventType): void {
    this.eventEmitter.emit('event', event);
  }

  /**
   * Get current trigger status
   */
  getStatus(): TriggerStatus {
    return this.status;
  }

  /**
   * Get current trigger status
   */
  get isStarted() {
    return this.status === TriggerStatus.LISTENING;
  }

  /**
   * Set the agent invocation function
   */
  setInvokeAgent(
    invokeAgent: (
      messages: HumanMessage[],
      config: RunnableConfig<BaseAgentConfigurable>,
    ) => Promise<AgentOutput>,
  ): void {
    this.invokeAgent = invokeAgent;
  }

  /**
   * Start the trigger
   * This is where the trigger begins listening for events
   */
  abstract start(config: TConfig): Promise<void>;

  /**
   * Stop the trigger
   * This is where the trigger stops listening and cleans up resources
   */
  abstract stop(): Promise<void>;

  /**
   * Handle trigger event
   * This is called when the trigger is activated
   */
  protected async handleTriggerEvent(
    event: TriggerEvent<TPayload>,
    config: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    if (!this.invokeAgent) {
      throw new BadRequestException(
        undefined,
        'Agent invocation function not set',
      );
    }

    this.logger?.debug('trigger.handle-event', {
      triggerId: event.triggerId,
      status: this.status,
    });

    // Convert payload to human messages
    const messages = this.convertPayloadToMessages(event.payload);

    this.logger?.debug('trigger.invoke', {
      messageCount: messages.length,
    });

    // Invoke the agent
    const result = await this.invokeAgent(messages, config);

    this.status = TriggerStatus.LISTENING;

    return result;
  }

  /**
   * Convert payload to human messages
   * Override this method to customize how payloads are converted to messages
   */
  protected abstract convertPayloadToMessages(
    payload: TPayload,
  ): HumanMessage[];
}
