import { Module } from '@nestjs/common';

import { SimpleKnowledge } from './services/simple-knowledge';

@Module({
  providers: [SimpleKnowledge],
  exports: [SimpleKnowledge],
})
export class AgentKnowledgeModule {}
