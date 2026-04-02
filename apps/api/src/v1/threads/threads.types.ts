export enum ThreadStatus {
  Running = 'running',
  Done = 'done',
  NeedMoreInfo = 'need_more_info',
  Stopped = 'stopped',
  Waiting = 'waiting',
}

export const THREAD_WAITING_EVENT = 'thread.waiting';

export interface ThreadWaitingEvent {
  graphId: string;
  nodeId: string;
  threadId: string;
  durationSeconds: number;
  checkPrompt: string;
  reason: string;
}
