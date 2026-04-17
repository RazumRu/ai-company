import { z } from 'zod';

export const CostLimitSettingsSchema = z.object({
  costLimitUsd: z.number().min(0).nullable().optional(),
});

export interface Settings {
  costLimitUsd?: number | null;
  [key: string]: unknown;
}
