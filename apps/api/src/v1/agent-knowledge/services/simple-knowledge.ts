import { Injectable, Scope } from '@nestjs/common';

import { IBaseKnowledgeOutput } from '../agent-knowledge.types';
import { BaseKnowledge } from './base-knowledge';

export interface SimpleKnowledgeConfig {
  content: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class SimpleKnowledge extends BaseKnowledge<SimpleKnowledgeConfig> {
  async getData(config: SimpleKnowledgeConfig): Promise<IBaseKnowledgeOutput> {
    return { content: config.content.trim() };
  }
}
