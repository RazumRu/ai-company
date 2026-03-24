import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';

const SIGNATURE_PREFIX = 'sha256=';

@Injectable()
export class GitHubWebhookSignatureService {
  verify(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!environment.githubWebhookSecret || !signatureHeader) {
      return false;
    }

    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
      return false;
    }

    const expectedSignature = signatureHeader.slice(SIGNATURE_PREFIX.length);

    // Validate that the signature is a well-formed hex-encoded SHA-256 digest
    // before passing to timingSafeEqual. Non-hex input could produce
    // different-length buffers, causing a RangeError.
    if (!/^[0-9a-f]{64}$/i.test(expectedSignature)) {
      return false;
    }

    const computed = createHmac('sha256', environment.githubWebhookSecret)
      .update(rawBody)
      .digest('hex');

    // Compare as UTF-8 byte buffers — both are hex strings of known length.
    // This follows GitHub's own recommended pattern.
    return timingSafeEqual(
      Buffer.from(computed, 'utf8'),
      Buffer.from(expectedSignature, 'utf8'),
    );
  }
}
