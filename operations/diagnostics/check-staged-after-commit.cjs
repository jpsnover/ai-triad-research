'use strict';
// PostToolUse hook: warns when files remain staged after a git commit.
// Catches the pattern where an explicit-pathspec commit silently leaves a
// staged file behind — verify passes (reads working tree) but CI fails
// because the omitted file is not in the committed tree (Sage #76).
//
// Invoked as: node -e INLINE_SCRIPT {command}
// argv[1] = the Bash command that just ran (passed by the hook runner).
// No stdin/JSON parsing — simpler and avoids async stdin-end race.

const { execSync } = require('child_process');

const cmd = process.argv[1] || '';

if (!/\bgit\b.*\bcommit\b/.test(cmd)) process.exit(0);

try {
  const staged = execSync('git diff --cached --name-only', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (staged) {
    process.stdout.write(
      'STAGED-AFTER-COMMIT: files remain staged after commit — NOT in the committed tree:\n\n' +
      staged + '\n\n' +
      'Create a follow-up commit with explicit pathspec. CI sees only committed trees.'
    );
  }
} catch {
  // Not a git repo or git unavailable — skip silently
}

process.exit(0);
