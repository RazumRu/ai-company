import { isObject } from 'lodash';
import { parse as parseYaml } from 'yaml';

import { TemplateRegistry } from '../graph-templates/services/template-registry';
import { type GraphAgentInfo, type GraphSchemaType, NodeKind } from './graphs.types';

export const parseStructuredContent = (input: unknown): unknown => {
  if (typeof input === 'string') {
    const jsonParsed = parseJsonContent(input);
    if (jsonParsed !== undefined) {
      return jsonParsed;
    }
    const yamlParsed = parseYamlContent(input);
    if (yamlParsed !== undefined) {
      return yamlParsed;
    }
    return input;
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (isObject(input)) return input as Record<string, unknown>;
  return input;
};

const parseJsonContent = (input: string): unknown | undefined => {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed;
  } catch {
    return undefined;
  }
};

const parseYamlContent = (input: string): unknown | undefined => {
  try {
    const parsed = parseYaml(input) as unknown;
    return parsed;
  } catch {
    return undefined;
  }
};

export function extractAgentsFromSchema(
  schema: GraphSchemaType,
  templateRegistry: TemplateRegistry,
): GraphAgentInfo[] {
  const agents: GraphAgentInfo[] = [];
  for (const node of schema.nodes) {
    const template = templateRegistry.getTemplate(node.template);
    if (template?.kind === NodeKind.SimpleAgent) {
      const name = typeof node.config.name === 'string' ? node.config.name : undefined;
      const description = typeof node.config.description === 'string' ? node.config.description : undefined;
      agents.push({
        nodeId: node.id,
        name: name ?? node.template,
        description: description || undefined,
      });
    }
  }
  return agents;
}
