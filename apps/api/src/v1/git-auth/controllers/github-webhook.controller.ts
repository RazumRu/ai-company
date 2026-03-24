import type { RawBodyRequest } from '@nestjs/common';
import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { GitHubWebhookSubscriptionService } from '../services/webhook-subscription-registry.service';

@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
@ApiExcludeController()
export class GitHubWebhookController {
  constructor(private readonly registry: GitHubWebhookSubscriptionService) {}

  @Post('github')
  @HttpCode(200)
  handleGitHubWebhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
  ): void {
    this.registry.handleWebhook(req.rawBody, signatureHeader, eventType);
  }
}
