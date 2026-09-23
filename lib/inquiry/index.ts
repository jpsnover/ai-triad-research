// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Barrel for the inquiry result contract (t/3574). Consumers import schemas, inferred types, and the
// shared `parseInquiryResult` from `lib/inquiry`. Per ADR-0002 §1 the dependency points FROM
// lib/debate INTO lib/inquiry, never the reverse — lib/inquiry must not import debate-engine logic.
// (parse.ts imports the ActionableError leaf-utility from lib/debate/errors, matching lib/ai-client's
// existing use of the same primitive; flagged to TL for a possible future extract to lib/errors.ts.)

export * from './schema.js';
export { parseInquiryResult } from './parse.js';
// Job-status vocabulary + truncation derivation, hoisted from server/inquiryJobs.ts (t/3609) so the
// server, Electron main, and renderer bridge all consume ONE definition instead of three copies.
export { isTerminalStatus, deriveTruncation, TRUNCATION_REASONS } from './jobStatus.js';
export type { InquiryJobStatus, InquiryPipelineStage } from './jobStatus.js';
