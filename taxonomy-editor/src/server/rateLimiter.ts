// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ── Sliding-window requests-per-minute ──

const requestWindows = new Map<string, number[]>();

export interface RateCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  retryAfterMs?: number;
}

export function checkRequestRate(userId: string, limit: number): RateCheckResult {
  const now = Date.now();
  const windowMs = 60_000;
  let timestamps = requestWindows.get(userId);
  if (!timestamps) { timestamps = []; requestWindows.set(userId, timestamps); }

  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();

  if (timestamps.length >= limit) {
    return { allowed: false, current: timestamps.length, limit, retryAfterMs: timestamps[0] + windowMs - now };
  }

  timestamps.push(now);
  return { allowed: true, current: timestamps.length, limit };
}

// ── Daily token accumulator ──

interface DailyTokenBucket {
  date: string;
  inputTokens: number;
  outputTokens: number;
  total: number;
}

const dailyTokens = new Map<string, DailyTokenBucket>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getBucket(userId: string): DailyTokenBucket {
  const d = today();
  let bucket = dailyTokens.get(userId);
  if (!bucket || bucket.date !== d) {
    bucket = { date: d, inputTokens: 0, outputTokens: 0, total: 0 };
    dailyTokens.set(userId, bucket);
  }
  return bucket;
}

export function recordTokenUsage(userId: string, inputTokens: number, outputTokens: number): void {
  const bucket = getBucket(userId);
  bucket.inputTokens += inputTokens;
  bucket.outputTokens += outputTokens;
  bucket.total += inputTokens + outputTokens;
}

export function checkTokenLimit(userId: string, limit: number): RateCheckResult {
  const bucket = getBucket(userId);
  return { allowed: bucket.total < limit, current: bucket.total, limit };
}

export function getUsage(userId: string): { requestsInWindow: number; tokensToday: number } {
  const now = Date.now();
  const cutoff = now - 60_000;
  const timestamps = requestWindows.get(userId) ?? [];
  const active = timestamps.filter(t => t >= cutoff).length;
  const bucket = getBucket(userId);
  return { requestsInWindow: active, tokensToday: bucket.total };
}

// ── Periodic cleanup ──

setInterval(() => {
  const now = Date.now();
  const cutoff = now - 120_000;
  for (const [key, timestamps] of requestWindows) {
    while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
    if (timestamps.length === 0) requestWindows.delete(key);
  }
  const d = today();
  for (const [key, bucket] of dailyTokens) {
    if (bucket.date !== d) dailyTokens.delete(key);
  }
}, 600_000).unref();
