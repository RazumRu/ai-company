export interface IEnrichedNotification<T> {
  type: EnrichedNotificationEvent;
  data: T;
  graphId: string;
  ownerId: string;
  nodeId?: string;
  threadId?: string;
  runId?: string;
}

export enum EnrichedNotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentStateUpdate = 'agent.state.update',
  ThreadUpdate = 'thread.update',
  GraphNodeUpdate = 'graph.node.update',
}
