import { describe, expect, it } from 'vitest';

import { ExecuteTriggerSchema, HumanMessageSchema } from './graphs.dto';

// 1x1 pixel PNG — valid small base64 image for tests
const VALID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ExecuteTriggerSchema', () => {
  it('accepts plain string messages', () => {
    const result = ExecuteTriggerSchema.safeParse({ messages: ['hello'] });
    expect(result.success).toBe(true);
  });

  it('accepts structured message with text and image blocks', () => {
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [
            { type: 'text', text: 'Describe this image' },
            {
              type: 'image_url',
              image_url: { url: VALID_PNG },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts mixed plain strings and structured messages', () => {
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        'plain string message',
        {
          content: [
            { type: 'text', text: 'multimodal message' },
            { type: 'image_url', image_url: { url: VALID_PNG } },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects image with unsupported MIME type', () => {
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [
            { type: 'text', text: 'look at this' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/bmp;base64,abc123' },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects oversized image (>5MB base64)', () => {
    // Generate a base64 string that exceeds 5MB when decoded
    // 5MB = 5 * 1024 * 1024 = 5242880 bytes
    // base64 encodes 3 bytes as 4 chars, so to exceed 5MB we need more than ceil(5242880 * 4/3) chars
    const oversizedBase64 = 'A'.repeat(
      Math.ceil((5 * 1024 * 1024 * 4) / 3) + 100,
    );
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [
            { type: 'text', text: 'look at this' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${oversizedBase64}` },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects structured message with no text block (image-only)', () => {
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [{ type: 'image_url', image_url: { url: VALID_PNG } }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects structured message with more than 5 images', () => {
    const imageBlock = {
      type: 'image_url' as const,
      image_url: { url: VALID_PNG },
    };
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [
            { type: 'text', text: 'many images' },
            imageBlock,
            imageBlock,
            imageBlock,
            imageBlock,
            imageBlock,
            imageBlock,
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 5 images (at the count boundary)', () => {
    const imageBlock = {
      type: 'image_url' as const,
      image_url: { url: VALID_PNG, detail: 'auto' as const },
    };
    const result = ExecuteTriggerSchema.safeParse({
      messages: [
        {
          content: [
            { type: 'text', text: 'five images' },
            imageBlock,
            imageBlock,
            imageBlock,
            imageBlock,
            imageBlock,
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('applies stripInvisibleUnicode transform to plain string messages', () => {
    // Zero-width space U+200B should be stripped
    const result = ExecuteTriggerSchema.safeParse({
      messages: ['hello\u200Bworld'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messages[0]).toBe('helloworld');
    }
  });
});

describe('HumanMessageSchema', () => {
  it('accepts plain string content', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts content as array with a text block', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: [{ type: 'text', text: 'hi' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts content as array with text and image blocks', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: [
        { type: 'text', text: 'what is this?' },
        {
          type: 'image_url',
          image_url: { url: VALID_PNG, detail: 'high' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty array content', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects image with invalid MIME type', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/tiff;base64,abc123' },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('defaults image detail to "auto" when not provided', () => {
    const result = HumanMessageSchema.safeParse({
      role: 'human',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image_url', image_url: { url: VALID_PNG } },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const blocks = result.data.content as {
        type: string;
        image_url?: { url: string; detail: string };
      }[];
      const imageBlock = blocks.find((b) => b.type === 'image_url');
      expect(imageBlock?.image_url?.detail).toBe('auto');
    }
  });
});
