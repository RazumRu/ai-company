import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, ModuleRef } from '@nestjs/core';

import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { AgentTriggersModule } from '../agent-triggers/agent-triggers.module';
import { AgentsModule } from '../agents/agents.module';
import { GraphResourcesModule } from '../graph-resources/graph-resources.module';
import { GraphsModule } from '../graphs/graphs.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { TemplatesController } from './controllers/templates.controller';
import { REGISTER_TEMPLATE_KEY } from './decorators/register-template.decorator';
import { TemplateRegistry } from './services/template-registry';
import { TemplatesService } from './services/templates.service';
import { SimpleAgentTemplate } from './templates/agents/simple-agent.template';
import { GithubResourceTemplate } from './templates/resources/github-resource.template';
import { DockerRuntimeTemplate } from './templates/runtimes/docker-runtime.template';
import { AgentCommunicationToolTemplate } from './templates/tools/agent-communication-tool.template';
import { GhToolTemplate } from './templates/tools/gh-tool.template';
import { ShellToolTemplate } from './templates/tools/shell-tool.template';
import { WebSearchToolTemplate } from './templates/tools/web-search-tool.template';
import { ManualTriggerTemplate } from './templates/triggers/manual-trigger.template';

@Module({
  imports: [
    RuntimeModule,
    AgentToolsModule,
    AgentsModule,
    AgentTriggersModule,
    GraphResourcesModule,
    forwardRef(() => GraphsModule),
    DiscoveryModule,
  ],
  controllers: [TemplatesController],
  providers: [
    TemplateRegistry,
    TemplatesService,
    // --- templates ---
    AgentCommunicationToolTemplate,
    DockerRuntimeTemplate,
    ShellToolTemplate,
    WebSearchToolTemplate,
    SimpleAgentTemplate,
    ManualTriggerTemplate,
    GhToolTemplate,
    // --- resources ---
    GithubResourceTemplate,
  ],
  exports: [TemplateRegistry, TemplatesService],
})
export class GraphTemplatesModule implements OnModuleInit {
  constructor(
    private readonly templateRegistry: TemplateRegistry,
    private readonly moduleRef: ModuleRef,
    private readonly discovery: DiscoveryService,
  ) {}

  async onModuleInit() {
    const wrappers = this.discovery.getProviders().filter((w) => w?.metatype);
    for (const w of wrappers) {
      const meta = Reflect.getMetadata(REGISTER_TEMPLATE_KEY, w.metatype || {});
      if (!meta) {
        continue;
      }

      const instance =
        w.instance ?? this.moduleRef.get(w.token, { strict: false });

      if (!instance) {
        continue;
      }

      this.templateRegistry.register(instance);
    }
  }
}
