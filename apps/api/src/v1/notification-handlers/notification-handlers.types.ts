export interface IEnrichedNotification<T> {
  type: EnrichedNotificationEvent;
  data: T;
  graphId: string;
  ownerId: string;
  nodeId?: string;
  threadId?: string;
}

export enum EnrichedNotificationEvent {
  Graph = 'graph.update',
  Checkpointer = 'graph.checkpointer.update',
  CheckpointerMessage = 'graph.checkpointer.message',
  CheckpointerToolCall = 'graph.checkpointer.tool_call',
}
