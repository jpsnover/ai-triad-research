#!/usr/bin/env node
/**
 * validate-doc-metadata.js
 *
 * PostToolUse hook script for the doc-metadata feedback rule.
 * Checks .md/.html files for required metadata fields and outputs
 * guidance to stdout when fields are missing.
 *
 * Usage: node validate-doc-metadata.js <file_path> <agent_full_name> <workspace_root>
 */

const fs = require("fs");
const path = require("path");

const filePath = process.argv[2];
const agentName = process.argv[3];
const workspaceRoot = process.argv[4];

if (!filePath || !fs.existsSync(filePath)) {
  process.exit(0);
}

const content = fs.readFileSync(filePath, "utf-8");
const lines = content.split("\n").slice(0, 40);
const header = lines.join("\n");

const ext = path.extname(filePath).toLowerCase();
const missing = [];

if (ext === ".md") {
  const hasTitle = lines.some((l) => /^#{1,2}\s+\S/.test(l));
  const hasLastUpdated = /\*\*Last updated:\*\*\s*\d{4}-\d{2}-\d{2}/i.test(header);
  const hasAuthor = /\*\*Author:\*\*/i.test(header) || /\*\*Authors:\*\*/i.test(header);

  if (!hasTitle) missing.push("title (# heading)");
  if (!hasLastUpdated) missing.push("**Last updated:** YYYY-MM-DD");
  if (!hasAuthor) missing.push("**Author:** name");
} else if (ext === ".html") {
  const hasTitle = /<title>[^<]+<\/title>/i.test(header);
  const hasMeta =
    /<meta\s+name=["']author["']/i.test(content) ||
    /<meta\s+name=["']date["']/i.test(content);

  if (!hasTitle) missing.push("<title>");
  if (!hasMeta) missing.push('<meta name="author"> and/or <meta name="date">');
} else {
  process.exit(0);
}

if (missing.length === 0) {
  process.exit(0);
}

const relPath = workspaceRoot
  ? path.relative(workspaceRoot, filePath).replace(/\\/g, "/")
  : filePath;

console.log(
  `[Doc Metadata] ${relPath} is missing: ${missing.join(", ")}. ` +
    `Add metadata near the top of the file. Example for .md:\n` +
    `  **Last updated:** ${new Date().toISOString().slice(0, 10)}\n` +
    `  **Author:** ${agentName || "Agent Name"}`
);
