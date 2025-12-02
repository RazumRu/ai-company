import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { z } from 'zod';

import { NodeKind } from '../../graphs/graphs.types';
import { NodeBaseTemplate } from '../templates/base-node.template';

/**
 * TemplateRegistry manages node type definitions for the Graph Compiler.
 * It allows registering node templates with their schemas and factory functions.
 */
@Injectable()
export class TemplateRegistry {
  private readonly templates = new Map<
    string,
    NodeBaseTemplate<z.ZodTypeAny>
  >();

  /**
   * Register a node template
   */
  register<TConfig extends z.ZodTypeAny, TOutput>(
    template: NodeBaseTemplate<TConfig, TOutput>,
  ): void {
    if (this.hasTemplate(template.id)) {
      throw new BadRequestException(
        undefined,
        `Template with id '${template.id}' is already registered`,
      );
    }

    this.templates.set(template.id, template);
  }

  /**
   * Get a template by id
   */
  getTemplate<TConfig extends z.ZodTypeAny, TOutput>(
    id: string,
  ): NodeBaseTemplate<TConfig, TOutput> | undefined {
    return this.templates.get(id) as NodeBaseTemplate<TConfig, TOutput>;
  }

  /**
   * Get all templates of a specific kind
   */
  getTemplatesByKind(kind: NodeKind): NodeBaseTemplate<z.ZodTypeAny>[] {
    return Array.from(this.templates.values()).filter(
      (template) => template.kind === kind,
    );
  }

  /**
   * Get all registered templates
   */
  getAllTemplates(): NodeBaseTemplate<z.ZodTypeAny>[] {
    return Array.from(this.templates.values());
  }

  /**
   * Check if a template exists
   */
  hasTemplate(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * Validate a template configuration
   */
  validateTemplateConfig<TConfig extends z.ZodTypeAny, TOutput>(
    templateId: string,
    config: unknown,
  ): z.infer<TConfig> {
    const template = this.getTemplate<TConfig, TOutput>(templateId);
    if (!template) {
      throw new BadRequestException(
        undefined,
        `Template '${templateId}' not found`,
      );
    }

    try {
      return template.schema.parse(config);
    } catch (error) {
      throw new BadRequestException(
        'INVALID_TEMPLATE_CONFIG',
        `Invalid configuration for template '${templateId}': ${error}`,
      );
    }
  }
}
