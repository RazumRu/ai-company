import { extractImagesFromContentBlocks } from '../../../../utils/imageAttachments';

export const formatMessageContent = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Extract text blocks from content block arrays (multimodal messages)
    return content
      .filter(
        (block: unknown) =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'text',
      )
      .map((block: unknown) => (block as { text?: string }).text ?? '')
      .join('\n');
  }
  if (typeof content === 'object' && content !== null) {
    return JSON.stringify(content, null, 2);
  }
  return String(content ?? '');
};

/** Extract image data URLs from content block arrays */
export const extractImageUrls = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }
  return extractImagesFromContentBlocks(content);
};

export const isBlankContent = (content: unknown): boolean => {
  if (content === null || content === undefined) {
    return true;
  }
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length === 0 || trimmed === '[]' || trimmed === '{}';
  }
  if (Array.isArray(content)) {
    return content.length === 0;
  }
  return false;
};

export const limitConsecutiveNewlines = (value: string): string =>
  value.replace(/(\r?\n){2,}/g, '\n');
