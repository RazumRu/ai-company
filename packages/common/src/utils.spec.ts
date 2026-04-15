import { describe, expect, it } from 'vitest';

import { extractErrorMessage } from './utils';

describe('extractErrorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a string value as-is', () => {
    expect(extractErrorMessage('nope')).toBe('nope');
  });

  it('extracts message from a plain object with `message`', () => {
    expect(extractErrorMessage({ message: 'connection reset' })).toBe(
      'connection reset',
    );
  });

  it('extracts message from nested `body.message` (k8s ApiException shape)', () => {
    expect(extractErrorMessage({ body: { message: 'pod terminated' } })).toBe(
      'pod terminated',
    );
  });

  it('extracts message from `response.body.message`', () => {
    expect(
      extractErrorMessage({
        response: { body: { message: 'forbidden' } },
      }),
    ).toBe('forbidden');
  });

  it('falls back to JSON serialization when no string message is present', () => {
    expect(extractErrorMessage({ statusCode: 500 })).toBe('{"statusCode":500}');
  });

  it('never returns the literal "[object Object]" for a plain object', () => {
    expect(extractErrorMessage({ foo: 'bar' })).not.toBe('[object Object]');
  });

  it('handles null and undefined', () => {
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
  });

  it('uses the Error name when the message is empty', () => {
    const err = new Error('');
    expect(extractErrorMessage(err)).toBe('Error');
  });

  it('extracts the underlying Error from a Symbol-keyed property (ws ErrorEvent shape)', () => {
    const wsErrorEvent = Object.create(null) as Record<symbol, unknown>;
    wsErrorEvent[Symbol('kError')] = new Error(
      'Unexpected server response: 403',
    );
    wsErrorEvent[Symbol('kMessage')] = 'Unexpected server response: 403';
    expect(extractErrorMessage(wsErrorEvent)).toBe(
      'Unexpected server response: 403',
    );
  });
});
