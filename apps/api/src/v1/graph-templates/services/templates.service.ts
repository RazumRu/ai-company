import { Injectable } from '@nestjs/common';

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
    }));

    return list;
  }

  private serializeSchema(schema: any): Record<string, unknown> {
    try {
      // Try to serialize the schema to a plain object
      return JSON.parse(JSON.stringify(schema._def || schema)) || {};
    } catch {
      // Fallback to empty object if serialization fails
      return {};
    }
  }
}
