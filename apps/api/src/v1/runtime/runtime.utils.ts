const SAFE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Wraps a shell value in single quotes, escaping any embedded single quotes
 * using the standard POSIX pattern: replace ' with '\''
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds a shell `export KEY=value; ...` prefix string for injecting
 * environment variables into a shell command. Keys that don't match the
 * safe identifier pattern are silently skipped to prevent injection.
 *
 * Returns an empty string when env is undefined or has no entries.
 */
export function buildEnvPrefix(
  env: Record<string, string> | undefined,
): string {
  if (!env || !Object.keys(env).length) {
    return '';
  }

  return `${Object.entries(env)
    .filter(([k]) => SAFE_KEY_PATTERN.test(k))
    .map(([k, v]) => `export ${k}=${shellEscape(v)}`)
    .join('; ')}; `;
}
