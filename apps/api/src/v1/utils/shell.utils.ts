/**
 * Escapes a string for safe use in shell commands by wrapping it in single quotes
 * and escaping any single quotes within the string.
 *
 * @param value - The string to escape
 * @returns The safely quoted string suitable for shell command execution
 *
 * @example
 * shQuote("hello world") // Returns: 'hello world'
 * shQuote("it's") // Returns: 'it'\''s'
 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
