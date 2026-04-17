import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CostLimitSettingsSchema } from '../../cost-limits/cost-limit-settings.schema';

export const ProjectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  settings: z.record(z.string(), z.unknown()),
  costLimitUsd: CostLimitSettingsSchema.shape.costLimitUsd,
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  graphCount: z.number().int().min(0),
  threadCount: z.number().int().min(0),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  costLimitUsd: CostLimitSettingsSchema.shape.costLimitUsd,
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export class ProjectDto extends createZodDto(ProjectSchema) {}
export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}
export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}
