import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import {
  CompleteJsonData,
  OpenaiService,
  ResponseJsonData,
} from '../../openai/openai.service';

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
    private readonly litellmService: LitellmService,
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
      const modelName = this.llmModelsService.getThreadNameModel();
      const supportsResponsesApi =
        await this.litellmService.supportsResponsesApi(modelName);
      const data: ResponseJsonData | CompleteJsonData = {
        model: modelName,
        systemMessage: [
          'You generate concise conversation titles.',
          'Generate a short title (maximum 100 characters) summarizing the conversation topic.',
          'Respond with ONLY JSON: {"title":"..."} with no extra text.',
        ].join(' '),
        message: `Generate a concise title for this conversation based on the first user message:\n\n${normalized}`,
        json: true as const,
        jsonSchema: ThreadTitleSchema,
        reasoning: {
          effort: 'none' as const,
        },
      };
      const llmContentOrEmptyPromise = (
        supportsResponsesApi
          ? this.openaiService.response<ThreadTitleResponse>(data)
          : this.openaiService.complete<ThreadTitleResponse>(data)
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
