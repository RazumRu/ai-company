import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';

const ThreadTitleSchema = z.object({
  title: z.string().min(1),
});
type ThreadTitleResponse = z.infer<typeof ThreadTitleSchema>;

@Injectable()
export class ThreadNameGeneratorService {
  private static readonly LLM_TIMEOUT_MS = 30_000;

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly litellmService: LitellmService,
    private readonly logger: DefaultLogger,
  ) {}

  async generateFromFirstUserMessage(
    userInput: string,
    model?: string,
  ): Promise<string | undefined> {
    const normalized = userInput.replace(/\s+/g, ' ').trim();
    if (!normalized.length) {
      return undefined;
    }

    const fallback = normalized.slice(0, 100);

    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const modelName = this.llmModelsService.getThreadNameModel(model);

      let supportsReasoning = false;
      try {
        supportsReasoning =
          await this.litellmService.supportsReasoning(modelName);
      } catch (err) {
        this.logger.error(
          `Thread name reasoning-capability check failed for ${modelName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const llmContentOrEmptyPromise = this.openaiService
        .jsonRequest<ThreadTitleResponse>({
          model: modelName,
          systemMessage: [
            'You generate concise conversation titles.',
            'Generate a short title (maximum 100 characters) summarizing the conversation topic.',
            'Respond with ONLY JSON: {"title":"..."} with no extra text.',
          ].join(' '),
          message: `Generate a concise title for this conversation based on the first user message:\n\n${normalized}`,
          jsonSchema: ThreadTitleSchema,
          maxOutputTokens: 1024,
          ...(supportsReasoning
            ? { reasoning: { effort: 'minimal' as const } }
            : {}),
        })
        .then((r) => {
          if (r.content == null) {
            this.logger.error('Thread name LLM response returned no content');
            return fallback;
          }
          const parsed = ThreadTitleSchema.safeParse(r.content);
          if (!parsed.success) {
            this.logger.error(
              `Thread name parse failed: ${parsed.error.message}, content=${JSON.stringify(r.content).slice(0, 200)}`,
            );
            return fallback;
          }
          return parsed.data.title;
        })
        .catch((err) => {
          this.logger.error(
            `Thread name LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return fallback;
        });

      const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(null),
          ThreadNameGeneratorService.LLM_TIMEOUT_MS,
        );
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
