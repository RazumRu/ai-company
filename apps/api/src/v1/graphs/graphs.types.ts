export enum NodeKind {
  Runtime = 'runtime',
  Tool = 'tool',
  SimpleAgent = 'simpleAgent',
}

export interface CompiledGraphNode<TInstance = unknown> {
  id: string;
  type: string;
  instance: TInstance;
}

export interface CompiledGraph {
  nodes: Map<string, CompiledGraphNode>;
  edges: {
    from: string;
    to: string;
    label?: string;
  }[];
  metadata?: {
    name?: string;
    description?: string;
    version?: string;
  };
}
