import { Module, OnModuleInit } from '@nestjs/common';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { TemplateRegistry } from '../graph-templates/services/template-registry';
import { InstructionBlocksController } from './controllers/instruction-blocks.controller';
import { InstructionBlockTemplateFactory } from './services/instruction-block-template.factory';
import { InstructionBlocksService } from './services/instruction-blocks.service';

@Module({
  imports: [GraphTemplatesModule],
  controllers: [InstructionBlocksController],
  providers: [InstructionBlocksService, InstructionBlockTemplateFactory],
  exports: [InstructionBlocksService],
})
export class InstructionBlocksModule implements OnModuleInit {
  constructor(
    private readonly instructionBlocksService: InstructionBlocksService,
    private readonly templateFactory: InstructionBlockTemplateFactory,
    private readonly templateRegistry: TemplateRegistry,
  ) {}

  onModuleInit(): void {
    const definitions = this.instructionBlocksService.getAll();
    for (const def of definitions) {
      const template = this.templateFactory.createTemplate(
        def,
        this.instructionBlocksService,
      );
      this.templateRegistry.register(template);
    }
  }
}
