// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Shared debate library — barrel export.
 * Consumed by taxonomy-editor (Electron app) and the future CLI debate runner.
 */

export * from './errors';
export * from './types';
export * from './taxonomyTypes';
export * from './prompts';
export * from './argumentNetwork';
export * from './taxonomyContext';
export * from './taxonomyRelevance';
export * from './harvestUtils';
export * from './protocols';
export * from './topics';
export * from './helpers';
export * from './aiAdapter';
export * from './taxonomyLoader';
export * from './debateEngine';
export * from './formatters';
