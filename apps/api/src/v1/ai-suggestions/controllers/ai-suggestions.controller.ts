import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import {
  SuggestAgentInstructionsDto,
  SuggestAgentInstructionsResponseDto,
} from '../dto/agent-instructions.dto';
import {
  SuggestKnowledgeContentDto,
  SuggestKnowledgeContentResponseDto,
} from '../dto/knowledge-suggestions.dto';
import {
  ThreadAnalysisRequestDto,
  ThreadAnalysisResponseDto,
} from '../dto/thread-analysis.dto';
import { AiSuggestionsService } from '../services/ai-suggestions.service';

@Controller()
@ApiTags('graphs', 'threads')
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

  @Post('threads/:threadId/analyze')
  async analyzeThread(
    @Param('threadId') threadId: string,
    @Body() payload: ThreadAnalysisRequestDto,
  ): Promise<ThreadAnalysisResponseDto> {
    return this.aiSuggestionsService.analyzeThread(threadId, payload);
  }

  @Post('graphs/:graphId/nodes/:nodeId/suggest-knowledge')
  async suggestKnowledgeContent(
    @Param('graphId') graphId: string,
    @Param('nodeId') nodeId: string,
    @Body() payload: SuggestKnowledgeContentDto,
  ): Promise<SuggestKnowledgeContentResponseDto> {
    return this.aiSuggestionsService.suggestKnowledgeContent(
      graphId,
      nodeId,
      payload,
    );
  }
}
