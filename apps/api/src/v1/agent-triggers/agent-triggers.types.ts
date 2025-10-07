/**
 * Trigger status enum
 */
export enum TriggerStatus {
  IDLE = 'idle',
  LISTENING = 'listening',
  DESTROYED = 'destroyed',
}

/**
 * Trigger event data
 */
export interface TriggerEvent<TPayload = unknown> {
  triggerId: string;
  timestamp: Date;
  payload: TPayload;
}
