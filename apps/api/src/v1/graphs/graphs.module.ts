import { Module, OnModuleInit } from '@nestjs/common';

import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { AgentsModule } from '../agents/agents.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { GraphCompiler } from './services/graph-compiler';
import { TemplateRegistry } from './services/template-registry';
import { DockerRuntimeTemplate } from './templates/docker-runtime.template';
import { ShellToolTemplate } from './templates/shell-tool.template';
import { SimpleAgentTemplate } from './templates/simple-agent.template';
import { WebSearchToolTemplate } from './templates/web-search-tool.template';

@Module({
  imports: [RuntimeModule, AgentToolsModule, AgentsModule],
  providers: [
    GraphCompiler,
    TemplateRegistry,
    DockerRuntimeTemplate,
    ShellToolTemplate,
    WebSearchToolTemplate,
    SimpleAgentTemplate,
  ],
  exports: [GraphCompiler, TemplateRegistry],
})
export class GraphsModule implements OnModuleInit {
  constructor(
    private readonly templateRegistry: TemplateRegistry,
    private readonly dockerRuntimeTemplate: DockerRuntimeTemplate,
    private readonly shellToolTemplate: ShellToolTemplate,
    private readonly webSearchToolTemplate: WebSearchToolTemplate,
    private readonly simpleAgentTemplate: SimpleAgentTemplate,
  ) {}

  onModuleInit() {
    // Register all templates
    this.templateRegistry.register(this.dockerRuntimeTemplate);
    this.templateRegistry.register(this.shellToolTemplate);
    this.templateRegistry.register(this.webSearchToolTemplate);
    this.templateRegistry.register(this.simpleAgentTemplate);
  }
}
