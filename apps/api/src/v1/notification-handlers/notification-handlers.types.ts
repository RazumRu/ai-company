export enum NotificationScope {
  /** Send notification only to graph room (users who explicitly subscribed) */
  Graph = 'graph',
  /** Send notification only to user room (owner's personal room) */
  User = 'user',
}

export interface IEnrichedNotification<T> {
  type: EnrichedNotificationEvent;
  data: T;
  graphId: string;
  ownerId: string;
  nodeId?: string;
  threadId?: string;
  runId?: string;
  scope: NotificationScope[];
}

export enum EnrichedNotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentStateUpdate = 'agent.state.update',
  ThreadCreate = 'thread.create',
  ThreadUpdate = 'thread.update',
  ThreadDelete = 'thread.delete',
  GraphNodeUpdate = 'graph.node.update',
  GraphRevisionCreate = 'graph.revision.create',
  GraphRevisionApplying = 'graph.revision.applying',
  GraphRevisionApplied = 'graph.revision.applied',
  GraphRevisionFailed = 'graph.revision.failed',
}
