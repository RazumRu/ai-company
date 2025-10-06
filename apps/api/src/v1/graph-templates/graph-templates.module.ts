import { Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, ModuleRef } from '@nestjs/core';

import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { AgentsModule } from '../agents/agents.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { REGISTER_TEMPLATE_KEY } from './decorators/register-template.decorator';
import { TemplateRegistry } from './services/template-registry';
import { SimpleAgentTemplate } from './templates/agents/simple-agent.template';
import { DockerRuntimeTemplate } from './templates/runtimes/docker-runtime.template';
import { AgentCommunicationToolTemplate } from './templates/tools/agent-communication-tool.template';
import { ShellToolTemplate } from './templates/tools/shell-tool.template';
import { WebSearchToolTemplate } from './templates/tools/web-search-tool.template';

@Module({
  imports: [RuntimeModule, AgentToolsModule, AgentsModule, DiscoveryModule],
  providers: [
    TemplateRegistry,
    // --- templates ---
    AgentCommunicationToolTemplate,
    DockerRuntimeTemplate,
    ShellToolTemplate,
    WebSearchToolTemplate,
    SimpleAgentTemplate,
  ],
  exports: [TemplateRegistry],
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
