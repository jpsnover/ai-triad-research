import { describe, it, expect } from 'vitest';
import { mapGeminiError } from './gemini.js';
import { ActionableError } from '../../debate/errors.js';

function geminiErrorBody(status: string, reason?: string): string {
  const details = reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [];
  return JSON.stringify({ error: { code: 401, message: 'Auth error', status, details } });
}

describe('mapGeminiError', () => {
  it('maps ACCESS_TOKEN_TYPE_UNSUPPORTED to OAuth-specific guidance', () => {
    const body = geminiErrorBody('UNAUTHENTICATED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
    const err = mapGeminiError(401, body);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.message).toContain('OAuth access token');
    expect(err.nextSteps.join(' ')).toContain('AIza');
  });

  it('maps generic 401 UNAUTHENTICATED to invalid-key guidance', () => {
    const body = geminiErrorBody('UNAUTHENTICATED', 'API_KEY_INVALID');
    const err = mapGeminiError(401, body);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.message).toContain('UNAUTHENTICATED');
    expect(err.nextSteps.join(' ')).toContain('invalid or revoked');
  });

  it('maps 401 without parseable reason to invalid-key guidance', () => {
    const err = mapGeminiError(401, 'not json');
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.nextSteps.join(' ')).toContain('invalid or revoked');
  });

  it('maps 403 PERMISSION_DENIED to permission guidance', () => {
    const body = geminiErrorBody('PERMISSION_DENIED');
    const err = mapGeminiError(403, body);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.message).toContain('PERMISSION_DENIED');
    expect(err.nextSteps.join(' ')).toContain('permission');
  });

  it('maps 404 NOT_FOUND to model-not-found guidance', () => {
    const body = JSON.stringify({ error: { code: 404, message: 'Model not found', status: 'NOT_FOUND', details: [] } });
    const err = mapGeminiError(404, body);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.message).toContain('NOT_FOUND');
    expect(err.nextSteps.join(' ')).toContain('model ID');
  });

  it('falls through to generic error for unknown status codes', () => {
    const body = JSON.stringify({ error: { code: 500, message: 'Internal', status: 'INTERNAL', details: [] } });
    const err = mapGeminiError(500, body);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.message).toContain('500');
    expect(err.nextSteps).toContain('Check your API key');
  });

  it('preserves raw body text in error message for flight recorder', () => {
    const body = geminiErrorBody('UNAUTHENTICATED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
    const err = mapGeminiError(401, body);
    expect(err.message).toContain('ACCESS_TOKEN_TYPE_UNSUPPORTED');
  });

  it('handles error JSON with no details array', () => {
    const body = JSON.stringify({ error: { code: 401, message: 'Bad key', status: 'UNAUTHENTICATED' } });
    const err = mapGeminiError(401, body);
    expect(err.nextSteps.join(' ')).toContain('invalid or revoked');
  });

  it('detects UNAUTHENTICATED via errorStatus even when HTTP status is not 401', () => {
    const body = geminiErrorBody('UNAUTHENTICATED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
    const err = mapGeminiError(400, body);
    expect(err.message).toContain('OAuth access token');
  });
});
