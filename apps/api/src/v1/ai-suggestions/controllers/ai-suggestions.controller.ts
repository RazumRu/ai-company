import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import {
  KnowledgeContentSuggestionRequestDto,
  KnowledgeContentSuggestionResponseDto,
  SuggestAgentInstructionsDto,
  SuggestAgentInstructionsResponseDto,
  SuggestGraphInstructionsDto,
  SuggestGraphInstructionsResponseDto,
  ThreadAnalysisRequestDto,
  ThreadAnalysisResponseDto,
} from '../dto/ai-suggestions.dto';
import { AiSuggestionsService } from '../services/ai-suggestions.service';

@Controller()
@ApiTags('graphs', 'threads', 'knowledge')
@ApiBearerAuth()
@OnlyForAuthorized()
export class AiSuggestionsController {
  constructor(private readonly aiSuggestionsService: AiSuggestionsService) {}

  @Post('graphs/:graphId/nodes/:nodeId/suggest-instructions')
  async suggestAgentInstructions(
    @Param('graphId') graphId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: SuggestAgentInstructionsDto,
  ): Promise<SuggestAgentInstructionsResponseDto> {
    return await this.aiSuggestionsService.suggest(graphId, nodeId, dto);
  }

  @Post('graphs/:graphId/suggest-instructions')
  async suggestGraphInstructions(
    @Param('graphId') graphId: string,
    @Body() dto: SuggestGraphInstructionsDto,
  ): Promise<SuggestGraphInstructionsResponseDto> {
    return await this.aiSuggestionsService.suggestGraphInstructions(
      graphId,
      dto,
    );
  }

  @Post('threads/:threadId/analyze')
  async analyzeThread(
    @Param('threadId') threadId: string,
    @Body() payload: ThreadAnalysisRequestDto,
  ): Promise<ThreadAnalysisResponseDto> {
    return this.aiSuggestionsService.analyzeThread(threadId, payload);
  }

  @Post('knowledge-docs/suggest')
  async suggestKnowledgeContent(
    @Body() payload: KnowledgeContentSuggestionRequestDto,
  ): Promise<KnowledgeContentSuggestionResponseDto> {
    return this.aiSuggestionsService.suggestKnowledgeContent(payload);
  }
}
