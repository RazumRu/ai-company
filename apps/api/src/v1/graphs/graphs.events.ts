export const GRAPH_DELETED_EVENT = 'graph.deleted';

export interface GraphDeletedEvent {
  graphId: string;
  userId: string;
}
