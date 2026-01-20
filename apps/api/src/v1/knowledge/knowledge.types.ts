export type KnowledgeChunkBoundary = {
  start: number;
  end: number;
  label?: string | null;
};

export type KnowledgeMetadata = {
  title: string;
  summary: string;
  tags: string[];
};
