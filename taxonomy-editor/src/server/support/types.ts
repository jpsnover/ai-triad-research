// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1189 (support ticketing): data model per the t/1174 HLD.

export type CaseStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type CasePriority = 'low' | 'medium' | 'high';

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;   // decoded byte length
  blobPath: string;    // path in the user-content store
  uploadedAt: string;  // ISO 8601
}

export interface CaseResponse {
  id: string;
  authorId: string;    // admin userId
  body: string;
  createdAt: string;
}

export interface SupportCaseSystemInfo {
  appVersion: string;
  browser: string;
  os: string;
  deploymentMode: 'web' | 'electron';
}

export interface SupportCase {
  id: string;                // UUID
  userId: string;            // storageUserId (owner)
  userDisplayName: string;   // for the admin view
  subject: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  createdAt: string;         // ISO 8601
  updatedAt: string;
  resolvedAt?: string;
  attachments: Attachment[];
  responses: CaseResponse[];
  systemInfo: SupportCaseSystemInfo;
}

// ── Attachment limits / validation (t/1189; sizes checked on DECODED bytes) ──
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per attachment
export const CASE_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB summed per case
export const CASE_MAX_ATTACHMENTS = 5;

const ALLOWED_MIME = [/^image\/[a-z0-9.+-]+$/i, /^video\/webm$/i, /^application\/json$/i, /^text\/plain$/i];
export function isAllowedAttachmentMime(mime: string): boolean {
  return typeof mime === 'string' && ALLOWED_MIME.some(re => re.test(mime));
}

export const STATUSES: readonly CaseStatus[] = ['open', 'in-progress', 'resolved', 'closed'];
export function isCaseStatus(v: unknown): v is CaseStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}
