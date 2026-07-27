// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Public share-link contract (t/1791 producer / t/1790 consumer). The path
// produced here MUST stay in sync with PublicPovView's route matcher
// (`nodeIdFromSharePath`); the colocated round-trip test locks the two together.

/**
 * The stable public share path for a POV node — appended to the web-app origin
 * by CopyLinkButton to form `https://<origin>/share/pov/<nodeId>`. POV nodes
 * only (v1); situations/policy are separate future exposures (t/1787).
 */
export function publicPovSharePath(nodeId: string): string {
  return `/share/pov/${nodeId}`;
}
