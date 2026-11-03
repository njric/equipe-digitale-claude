// Hook: PreToolUse (Bash|PowerShell)
// Blocks PR creation on web projects when plans/impact.md was not updated on
// the branch (eco-design impact review missing). Fail-open on internal errors.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runHook, projectDir, tryGit, blockWithMessage } from './lib/hook-io.mjs';

// origin/HEAD is missing on repositories created locally then pushed:
// fall back to the usual default branch names, master included.
function findBaseBranch() {
  const remoteHead = tryGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (remoteHead) return remoteHead;
  return ['origin/main', 'origin/master'].find((candidate) => tryGit(['rev-parse', '--verify', '-q', candidate]) !== null) ?? null;
}

runHook((input) => {
  const command = input.tool_input?.command ?? '';
  if (!/\bgh\s+pr\s+create\b/.test(command)) return;
  if (!existsSync(join(projectDir(), 'package.json'))) return;

  const base = findBaseBranch();
  if (!base) return;
  // '--' tells git that what precedes is a revision, not a file path.
  const changed = tryGit(['diff', '--name-only', `${base}...HEAD`, '--']);
  if (changed === null) return;
  if (changed.split(/\r?\n/).includes('plans/impact.md')) return;

  blockWithMessage([
    '🌱 Impact review missing: plans/impact.md was not updated on this branch.',
    "Run the eco-design skill's impact review before opening the Pull Request.",
  ]);
});
