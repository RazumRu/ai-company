import { Injectable } from '@nestjs/common';
import { sortBy } from 'lodash';
import { z, ZodSchema } from 'zod';

import { TemplateDto } from '../dto/templates.dto';
import { TemplateRegistry } from './template-registry';

@Injectable()
export class TemplatesService {
  constructor(private readonly templateRegistry: TemplateRegistry) {}

  async getAllTemplates(): Promise<TemplateDto[]> {
    const templates = this.templateRegistry.getAllTemplates();

    const list: TemplateDto[] = templates.map((template) => ({
      name: template.name,
      description: template.description,
      kind: template.kind,
      schema: this.serializeSchema(template.schema),
      inputs: template.inputs ? [...template.inputs] : undefined,
      outputs: template.outputs ? [...template.outputs] : undefined,
    }));

    return sortBy(list, 'kind');
  }

  private serializeSchema(schema: ZodSchema): Record<string, unknown> {
    return z.toJSONSchema(schema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }
}
