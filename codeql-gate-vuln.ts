// t/2025 CodeQL gate-verify — NEW-HIGH case (throwaway, DO NOT MERGE, auto-deleted).
// Deliberate command injection (js/command-line-injection, high/critical) to prove
// the gate BLOCKS a PR that introduces a NEW high-severity alert.
import { exec } from 'node:child_process';
import http from 'node:http';

http.createServer((req, res) => {
  const cmd = new URL(req.url ?? '/', 'http://localhost').searchParams.get('c') ?? '';
  // Untrusted request data flows straight into a shell — CodeQL flags this.
  exec(cmd, () => res.end('ok'));
}).listen(3000);
