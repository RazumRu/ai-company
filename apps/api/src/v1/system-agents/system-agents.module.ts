import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { TemplateRegistry } from '../graph-templates/services/template-registry';
import { GraphsModule } from '../graphs/graphs.module';
import { SystemAgentsController } from './controllers/system-agents.controller';
import { SystemAgentTemplateFactory } from './services/system-agent-template.factory';
import { SystemAgentsService } from './services/system-agents.service';

@Module({
  imports: [GraphTemplatesModule, forwardRef(() => GraphsModule)],
  controllers: [SystemAgentsController],
  providers: [SystemAgentsService, SystemAgentTemplateFactory],
  exports: [SystemAgentsService],
})
export class SystemAgentsModule implements OnModuleInit {
  constructor(
    private readonly systemAgentsService: SystemAgentsService,
    private readonly templateFactory: SystemAgentTemplateFactory,
    private readonly templateRegistry: TemplateRegistry,
  ) {}

  onModuleInit(): void {
    const definitions = this.systemAgentsService.getAll();
    for (const def of definitions) {
      const template = this.templateFactory.createTemplate(def);
      this.templateRegistry.register(template);
    }
  }
}
