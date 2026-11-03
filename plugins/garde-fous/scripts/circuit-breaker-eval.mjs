// Hooks: PostToolUse and PostToolUseFailure (Bash|PowerShell)
// Counts consecutive failures of network calls, per endpoint.
// A non-zero exit code fires PostToolUseFailure (no exit_code field is sent);
// exit 0 fires PostToolUse. Limit: curl without -f returns 0 on an HTTP error.

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runHook } from './lib/hook-io.mjs';
import { extractEndpoint, stateFilePath } from './lib/endpoint.mjs';

runHook((input) => {
  const endpoint = extractEndpoint(input.tool_input?.command);
  if (!endpoint) return;
  // A user interruption is not an endpoint failure.
  if (input.is_interrupt === true) return;

  const stateFile = stateFilePath(input.session_id);
  let state = {};
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }
  }

  const previousAttempts = Number.isInteger(state[endpoint]?.attempts) ? state[endpoint].attempts : 0;
  const attempts = input.hook_event_name === 'PostToolUseFailure' ? previousAttempts + 1 : 0;
  state[endpoint] = { attempts, last: Math.floor(Date.now() / 1000) };

  // Atomic save: a concurrent reader never sees a half-written file. The
  // unique name keeps parallel tool calls from overwriting each other's temp file.
  const temporaryFile = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporaryFile, stateFile);
});
