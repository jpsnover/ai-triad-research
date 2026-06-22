// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

const REDACTED = '[REDACTED]';

const API_KEY_PATTERNS: RegExp[] = [
  /AIzaSy[A-Za-z0-9_-]{33}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bkey-[A-Za-z0-9]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bghp_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
];

const BEARER_RE = /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi;
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const SENSITIVE_FIELD_RE = /key|token|secret|password|authorization/i;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{30,}/g;

/** Redact known-sensitive patterns (API keys, Bearer tokens, emails) from a string. */
export function redactString(value: string): string {
  let s = value;
  for (const re of API_KEY_PATTERNS) {
    s = s.replace(re, REDACTED);
  }
  s = s.replace(BEARER_RE, `Bearer ${REDACTED}`);
  s = s.replace(EMAIL_RE, (_m, first: string, domain: string) => `${first}***@${domain}`);
  return s;
}

/**
 * Redact a field value. Applies standard string redaction plus, for fields
 * whose name implies a secret (key, token, secret, password, authorization),
 * also strips generic long tokens (30+ alphanumeric chars).
 */
export function redactFieldValue(key: string, value: string): string {
  let s = redactString(value);
  if (SENSITIVE_FIELD_RE.test(key)) {
    s = s.replace(LONG_TOKEN_RE, REDACTED);
  }
  return s;
}

/** Deep-redact all string values in a data record. */
export function redactRecord(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      result[key] = redactFieldValue(key, value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactRecord(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
