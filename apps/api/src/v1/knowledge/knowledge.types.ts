export type KnowledgeChunkBoundary = {
  start: number;
  end: number;
  label?: string | null;
};

export type KnowledgeSummary = {
  summary: string;
};
