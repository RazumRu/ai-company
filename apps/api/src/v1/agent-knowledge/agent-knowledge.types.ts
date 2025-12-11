export interface IBaseKnowledgeOutput<T = unknown> {
  content: string;
  data?: T;
}
