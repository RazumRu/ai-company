import { IBaseKnowledgeOutput } from '../agent-knowledge.types';

export abstract class BaseKnowledge<
  TConfig = unknown,
  TOutput extends IBaseKnowledgeOutput = IBaseKnowledgeOutput,
> {
  public setup?(config: TConfig): Promise<void>;

  public abstract getData(config: TConfig): Promise<TOutput>;
}
