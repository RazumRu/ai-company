/** Maximum number of tags allowed per knowledge document. */
export const MAX_TAGS = 12;

/**
 * Normalize an array of tags: trim, lowercase, deduplicate, and cap at `maxTags`.
 */
export function normalizeTags(tags: string[], maxTags: number): string[] {
  const normalized = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, maxTags);
}

/**
 * Normalize optional filter tags for queries.
 * Returns `undefined` when the input is empty so callers can skip the filter.
 */
export function normalizeFilterTags(tags?: string[]): string[] | undefined {
  if (!tags || tags.length === 0) {
    return undefined;
  }
  return Array.from(
    new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  );
}

/**
 * Escape Postgres LIKE/ILIKE special characters so they are matched literally.
 */
export function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
