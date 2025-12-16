import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { OpenaiService } from '../../openai/openai.service';

@Injectable()
export class ThreadNameGeneratorService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly logger: DefaultLogger,
  ) {}

  async generateFromFirstUserMessage(
    userInput: string,
  ): Promise<string | undefined> {
    const normalized = userInput.replace(/\s+/g, ' ').trim();
    if (!normalized.length) {
      return undefined;
    }

    const fallback = normalized.slice(0, 100);

    try {
      const llmTimeoutMs = 30000;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const llmContentOrEmptyPromise = this.openaiService
        .response(
          {
            systemMessage: [
              'You generate concise conversation titles.',
              'Generate a short title (maximum 100 characters) summarizing the conversation topic.',
              'Respond with ONLY the title, no additional text or explanation.',
            ].join(' '),
            message: `Generate a concise title for this conversation based on the first user message:\n\n${normalized}`,
          },
          {
            model: 'gpt-5-mini',
          },
        )
        .then((r) => r.content ?? '')
        .catch(() => '');

      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), llmTimeoutMs);
      });

      const winner = await Promise.race([
        llmContentOrEmptyPromise,
        timeoutPromise,
      ]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (winner === null) {
        return fallback;
      }

      const title = winner.trim().slice(0, 100);
      return title.length ? title : fallback;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(err, `thread-name-generator.error: ${err.message}`);
      return fallback;
    }
  }
}
