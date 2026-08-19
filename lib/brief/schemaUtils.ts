// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

type JsonObject = Record<string, unknown>;

/**
 * Mechanically derive the lenient read-time schema from a strict write-time schema.
 * Strips all `additionalProperties: false` entries recursively, preserving all
 * type/required/enum constraints. The strict schema is the single source of truth;
 * this function produces the read variant — do not hand-maintain two schema files.
 */
export function deriveReadSchema(strict: JsonObject): JsonObject {
  const clone: JsonObject = JSON.parse(JSON.stringify(strict));
  stripAdditionalPropertiesFalse(clone);
  return clone;
}

function stripAdditionalPropertiesFalse(obj: JsonObject): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (obj['additionalProperties'] === false) delete obj['additionalProperties'];
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      stripAdditionalPropertiesFalse(value as JsonObject);
    }
  }
}

/** True if any node in the schema tree carries additionalProperties:false. */
export function hasAdditionalPropertiesFalse(schema: JsonObject): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  if (schema['additionalProperties'] === false) return true;
  return Object.values(schema).some(
    v => typeof v === 'object' && v !== null && hasAdditionalPropertiesFalse(v as JsonObject),
  );
}
