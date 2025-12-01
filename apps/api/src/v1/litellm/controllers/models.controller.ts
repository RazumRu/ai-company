import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import { LiteLlmModelDto } from '../dto/models.dto';
import { LitellmService } from '../services/litellm.service';

@Controller('litellm')
@ApiTags('litellm')
@ApiBearerAuth()
@OnlyForAuthorized()
export class ModelsController {
  constructor(private readonly modelsService: LitellmService) {}

  @Get('/models')
  async listModels(): Promise<LiteLlmModelDto[]> {
    return this.modelsService.listModels();
  }
}
