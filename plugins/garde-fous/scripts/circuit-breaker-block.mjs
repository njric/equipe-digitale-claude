// Hook: PreToolUse (Bash|PowerShell)
// Denies calls to an endpoint while its circuit is open (>= 3 recent consecutive failures).

import { existsSync, readFileSync } from 'node:fs';
import { runHook, denyToolUse } from './lib/hook-io.mjs';
import { extractEndpoint, stateFilePath, FAILURE_THRESHOLD, OPEN_WINDOW_SECONDS } from './lib/endpoint.mjs';

runHook((input) => {
  const endpoint = extractEndpoint(input.tool_input?.command);
  if (!endpoint) return;

  const stateFile = stateFilePath(input.session_id);
  // No state file means no failure yet.
  if (!existsSync(stateFile)) return;

  const entry = JSON.parse(readFileSync(stateFile, 'utf8'))[endpoint] ?? { attempts: 0, last: 0 };
  // Unreadable state: let the call through rather than block it wrongly.
  if (!Number.isInteger(entry.attempts) || !Number.isInteger(entry.last)) return;

  const elapsedSeconds = Math.floor(Date.now() / 1000) - entry.last;
  if (entry.attempts >= FAILURE_THRESHOLD && elapsedSeconds <= OPEN_WINDOW_SECONDS) {
    const remaining = OPEN_WINDOW_SECONDS - elapsedSeconds;
    denyToolUse(
      `🚨 CIRCUIT BREAKER OUVERT : ${entry.attempts} échecs consécutifs détectés vers ${endpoint}. ` +
      `L'accès à cet endpoint est suspendu pour encore ${remaining} secondes. ` +
      `Utilise un fallback, analyse les erreurs précédentes ou demande l'avis de l'utilisateur.`,
    );
  }
});
