// Shared input/output helpers for the hooks.
// Every hook is fail-open: an internal error must never block the user's work,
// so runHook turns any exception into a silent exit 0.

import { readFileSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function readHookInput() {
  const raw = readFileSync(0, 'utf8');
  return raw.trim() ? JSON.parse(raw) : null;
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

// Runs git without a shell: no quoting issue on Windows, no injection through file names.
export function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd ?? projectDir(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // No limit: a capped buffer would turn a large diff into "nothing to scan".
    maxBuffer: Infinity,
  });
}

// Returns git's output, or null when git fails (not a repo, unknown revision...).
export function tryGit(args, options) {
  try {
    return git(args, options);
  } catch {
    return null;
  }
}

// Synchronous writes: process.stdout.write is asynchronous on macOS pipes and
// could be cut short by process.exit.
export function writeStdout(text) {
  writeSync(1, text);
}

// Exit code 2 blocks the tool call and shows stderr to Claude.
export function blockWithMessage(lines) {
  writeSync(2, lines.join('\n') + '\n');
  process.exit(2);
}

export function printJson(payload) {
  writeStdout(JSON.stringify(payload) + '\n');
}

export function denyToolUse(reason) {
  printJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

export function runHook(handler) {
  try {
    const input = readHookInput();
    if (!input) process.exit(0);
    handler(input);
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
