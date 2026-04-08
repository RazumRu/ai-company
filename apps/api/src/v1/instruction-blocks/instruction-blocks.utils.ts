import matter from 'gray-matter';
import { z } from 'zod';

import { computeContentHash } from '../system-agents/system-agents.utils';
import type { InstructionBlockDefinition } from './instruction-blocks.types';

export const InstructionBlockFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

export function parseInstructionBlockFile(
  filePath: string,
  fileContent: string,
): InstructionBlockDefinition {
  const parsed = matter(fileContent);

  const frontmatterResult = InstructionBlockFrontmatterSchema.safeParse(
    parsed.data,
  );

  if (!frontmatterResult.success) {
    throw new Error(
      `Invalid frontmatter in ${filePath}: ${frontmatterResult.error.message}`,
    );
  }

  const frontmatter = frontmatterResult.data;
  const instructions = parsed.content.trim();
  const contentHash = computeContentHash(fileContent);
  const templateId = `instruction-block-${frontmatter.id}`;

  return {
    id: frontmatter.id,
    name: frontmatter.name,
    description: frontmatter.description,
    instructions,
    contentHash,
    templateId,
  };
}
