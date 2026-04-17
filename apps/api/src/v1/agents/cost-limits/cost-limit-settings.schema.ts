import { z } from 'zod';

export const CostLimitSettingsSchema = z.object({
  costLimitUsd: z.number().min(0).nullable().optional(),
});

export type CostLimitSettings = z.infer<typeof CostLimitSettingsSchema>;
