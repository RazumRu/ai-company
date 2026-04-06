import { describe, expect, it } from 'vitest';

import {
  extractImageUrls,
  formatMessageContent,
  isBlankContent,
} from './messageUtils';

describe('formatMessageContent', () => {
  it('returns string content as-is', () => {
    expect(formatMessageContent('hello')).toBe('hello');
  });

  it('extracts text from content block arrays', () => {
    const blocks = [
      { type: 'text', text: 'Look at this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];
    expect(formatMessageContent(blocks)).toBe('Look at this');
  });

  it('joins multiple text blocks with newlines', () => {
    const blocks = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
    ];
    expect(formatMessageContent(blocks)).toBe('Line 1\nLine 2');
  });

  it('returns empty string for empty content block array', () => {
    expect(formatMessageContent([])).toBe('');
  });

  it('JSON-stringifies plain objects', () => {
    expect(formatMessageContent({ key: 'val' })).toBe(
      JSON.stringify({ key: 'val' }, null, 2),
    );
  });
});

describe('extractImageUrls', () => {
  it('returns empty array for string content', () => {
    expect(extractImageUrls('hello')).toEqual([]);
  });

  it('extracts image URLs from content blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,def' } },
    ];
    expect(extractImageUrls(blocks)).toEqual([
      'data:image/png;base64,abc',
      'data:image/jpeg;base64,def',
    ]);
  });

  it('returns empty array for non-array input', () => {
    expect(extractImageUrls(null)).toEqual([]);
    expect(extractImageUrls(undefined)).toEqual([]);
  });
});

describe('isBlankContent', () => {
  it('returns true for null/undefined', () => {
    expect(isBlankContent(null)).toBe(true);
    expect(isBlankContent(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isBlankContent('')).toBe(true);
    expect(isBlankContent('  ')).toBe(true);
  });

  it('returns false for non-empty content block array', () => {
    expect(isBlankContent([{ type: 'text', text: 'hi' }])).toBe(false);
  });

  it('returns true for empty array', () => {
    expect(isBlankContent([])).toBe(true);
  });
});
