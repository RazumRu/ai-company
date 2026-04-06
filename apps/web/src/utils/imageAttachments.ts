import type { ContentBlock } from '../pages/graphs/types/messages';

export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

export interface ImageAttachment {
  id: string;
  dataUrl: string;
  fileName: string;
  sizeBytes: number;
}

/** Convert a File to a Base64 data URL */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Validate an image file. Returns error message or null if valid. */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `Unsupported image type: ${file.type}. Allowed: PNG, JPEG, GIF, WebP`;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum: 5 MB`;
  }
  return null;
}

/** Build content blocks array from text and images */
export function buildContentBlocks(
  text: string,
  images: ImageAttachment[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (text.trim()) {
    blocks.push({ type: 'text', text: text.trim() });
  }
  for (const img of images) {
    blocks.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    });
  }
  return blocks;
}

/** Extract plain text from content (string or content block array) */
export function extractTextFromContentBlocks(
  content: string | ContentBlock[],
): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter(
      (block): block is ContentBlock & { type: 'text' } =>
        block.type === 'text',
    )
    .map((block) => block.text ?? '')
    .join('\n');
}

/** Extract image data URLs from content block arrays */
export function extractImagesFromContentBlocks(
  content: string | ContentBlock[],
): string[] {
  if (typeof content === 'string') {
    return [];
  }
  return content
    .filter(
      (block): block is ContentBlock & { type: 'image_url' } =>
        block.type === 'image_url',
    )
    .map((block) => block.image_url?.url ?? '')
    .filter(Boolean);
}
