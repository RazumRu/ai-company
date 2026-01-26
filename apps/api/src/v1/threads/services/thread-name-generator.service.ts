import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';

const ThreadTitleSchema = z.object({
  title: z.string().min(1).max(100),
});
type ThreadTitleResponse = z.infer<typeof ThreadTitleSchema>;

@Injectable()
export class ThreadNameGeneratorService {
  constructor(
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
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
      const compiledSchema = zodResponseFormat(ThreadTitleSchema, 'data');

      const llmContentOrEmptyPromise = this.openaiService
        .response<ThreadTitleResponse>(
          {
            systemMessage: [
              'You generate concise conversation titles.',
              'Generate a short title (maximum 100 characters) summarizing the conversation topic.',
              'Respond with ONLY JSON: {"title":"..."} with no extra text.',
            ].join(' '),
            message: `Generate a concise title for this conversation based on the first user message:\n\n${normalized}`,
          },
          {
            model: this.llmModelsService.getThreadNameModel(),
            reasoning: {
              effort: 'none',
            },
            text: {
              format: {
                ...compiledSchema.json_schema,
                schema: compiledSchema.json_schema.schema!,
                type: 'json_schema',
              },
            },
          },
          { json: true },
        )
        .then((r) => {
          const parsed = ThreadTitleSchema.safeParse(r.content);
          return parsed.success ? parsed.data.title : '';
        })
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
