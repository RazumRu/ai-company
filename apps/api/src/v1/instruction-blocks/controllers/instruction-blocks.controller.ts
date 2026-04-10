import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import { InstructionBlockResponseDto } from '../dto/instruction-blocks.dto';
import { InstructionBlocksService } from '../services/instruction-blocks.service';

@Controller('instruction-blocks')
@ApiTags('instruction-blocks')
@ApiBearerAuth()
@OnlyForAuthorized()
export class InstructionBlocksController {
  constructor(
    private readonly instructionBlocksService: InstructionBlocksService,
  ) {}

  @Get()
  async getAll(): Promise<InstructionBlockResponseDto[]> {
    return await this.instructionBlocksService.getAll();
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<InstructionBlockResponseDto> {
    return await this.instructionBlocksService.getById(id);
  }
}
