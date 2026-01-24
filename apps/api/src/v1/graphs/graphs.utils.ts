import { isObject } from 'lodash';
import { parse as parseYaml } from 'yaml';

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
