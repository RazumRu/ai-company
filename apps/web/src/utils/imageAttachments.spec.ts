import { describe, expect, it } from 'vitest';

import type { ContentBlock } from '../pages/graphs/types/messages';
import type { ImageAttachment } from './imageAttachments';
import {
  ALLOWED_IMAGE_TYPES,
  buildContentBlocks,
  extractImagesFromContentBlocks,
  extractTextFromContentBlocks,
  MAX_IMAGE_SIZE_BYTES,
  validateImageFile,
} from './imageAttachments';

const mockFile = (type: string, size: number) => ({ type, size }) as File;

describe('validateImageFile', () => {
  it('accepts valid PNG files', () => {
    expect(validateImageFile(mockFile('image/png', 100))).toBeNull();
  });

  it('accepts valid JPEG files', () => {
    expect(validateImageFile(mockFile('image/jpeg', 100))).toBeNull();
  });

  it('accepts valid GIF files', () => {
    expect(validateImageFile(mockFile('image/gif', 100))).toBeNull();
  });

  it('accepts valid WebP files', () => {
    expect(validateImageFile(mockFile('image/webp', 100))).toBeNull();
  });

  it('rejects unsupported MIME types', () => {
    const result = validateImageFile(mockFile('image/bmp', 100));
    expect(result).not.toBeNull();
    expect(result).toContain('Unsupported image type: image/bmp');
    expect(result).toContain('PNG, JPEG, GIF, WebP');
  });

  it('rejects non-image MIME types', () => {
    const result = validateImageFile(mockFile('application/pdf', 100));
    expect(result).not.toBeNull();
    expect(result).toContain('Unsupported image type: application/pdf');
  });

  it('rejects files exceeding 5 MB', () => {
    const result = validateImageFile(
      mockFile('image/png', MAX_IMAGE_SIZE_BYTES + 1),
    );
    expect(result).not.toBeNull();
    expect(result).toContain('too large');
    expect(result).toContain('Maximum: 5 MB');
  });

  it('accepts files exactly at the 5 MB limit', () => {
    expect(
      validateImageFile(mockFile('image/png', MAX_IMAGE_SIZE_BYTES)),
    ).toBeNull();
  });

  it('includes the file size in the error message for oversized files', () => {
    const sizeBytes = 6 * 1024 * 1024; // 6 MB
    const result = validateImageFile(mockFile('image/png', sizeBytes));
    expect(result).toContain('6.0 MB');
  });

  it('covers all allowed image types without error', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(validateImageFile(mockFile(type, 100))).toBeNull();
    }
  });
});

describe('buildContentBlocks', () => {
  const makeImage = (id: string): ImageAttachment => ({
    id,
    dataUrl: `data:image/png;base64,abc${id}`,
    fileName: `image-${id}.png`,
    sizeBytes: 100,
  });

  it('creates a text block and image blocks', () => {
    const blocks = buildContentBlocks('Hello', [makeImage('1')]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Hello' });
    expect(blocks[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc1', detail: 'auto' },
    });
  });

  it('handles empty text — omits text block', () => {
    const blocks = buildContentBlocks('', [makeImage('1')]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('image_url');
  });

  it('handles whitespace-only text — omits text block', () => {
    const blocks = buildContentBlocks('   ', [makeImage('1')]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('image_url');
  });

  it('handles no images — returns only text block', () => {
    const blocks = buildContentBlocks('Hello', []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'Hello' });
  });

  it('returns empty array when both text and images are empty', () => {
    expect(buildContentBlocks('', [])).toHaveLength(0);
  });

  it('trims whitespace from text content', () => {
    const blocks = buildContentBlocks('  Hello  ', []);
    expect((blocks[0] as ContentBlock & { type: 'text' }).text).toBe('Hello');
  });

  it('creates one image block per attachment', () => {
    const blocks = buildContentBlocks('', [
      makeImage('1'),
      makeImage('2'),
      makeImage('3'),
    ]);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === 'image_url')).toBe(true);
  });
});

describe('extractTextFromContentBlocks', () => {
  it('returns the string as-is when content is a string', () => {
    expect(extractTextFromContentBlocks('hello world')).toBe('hello world');
  });

  it('returns empty string when content is an empty string', () => {
    expect(extractTextFromContentBlocks('')).toBe('');
  });

  it('extracts text from a single text block', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello' }];
    expect(extractTextFromContentBlocks(blocks)).toBe('Hello');
  });

  it('joins multiple text blocks with newline', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
    ];
    expect(extractTextFromContentBlocks(blocks)).toBe('Line 1\nLine 2');
  });

  it('ignores image_url blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];
    expect(extractTextFromContentBlocks(blocks)).toBe('Hello');
  });

  it('returns empty string when there are no text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];
    expect(extractTextFromContentBlocks(blocks)).toBe('');
  });

  it('handles text block with undefined text field', () => {
    const blocks: ContentBlock[] = [{ type: 'text' }];
    expect(extractTextFromContentBlocks(blocks)).toBe('');
  });
});

describe('extractImagesFromContentBlocks', () => {
  it('returns empty array when content is a string', () => {
    expect(extractImagesFromContentBlocks('hello')).toEqual([]);
  });

  it('returns empty array for empty string content', () => {
    expect(extractImagesFromContentBlocks('')).toEqual([]);
  });

  it('extracts data URL from image_url block', () => {
    const blocks: ContentBlock[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];
    expect(extractImagesFromContentBlocks(blocks)).toEqual([
      'data:image/png;base64,abc',
    ]);
  });

  it('extracts multiple image URLs', () => {
    const blocks: ContentBlock[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,bbb' } },
    ];
    expect(extractImagesFromContentBlocks(blocks)).toEqual([
      'data:image/png;base64,aaa',
      'data:image/jpeg;base64,bbb',
    ]);
  });

  it('returns empty array when there are no image blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello' }];
    expect(extractImagesFromContentBlocks(blocks)).toEqual([]);
  });

  it('ignores text blocks and returns only image URLs', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];
    expect(extractImagesFromContentBlocks(blocks)).toEqual([
      'data:image/png;base64,abc',
    ]);
  });

  it('filters out blocks with missing url', () => {
    const blocks: ContentBlock[] = [
      { type: 'image_url', image_url: { url: '' } },
    ];
    expect(extractImagesFromContentBlocks(blocks)).toEqual([]);
  });
});
