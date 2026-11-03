// Network-call detection shared by circuit-breaker-block and circuit-breaker-eval,
// so both hooks always agree on which endpoint a command targets.

import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Includes the PowerShell equivalents of curl, used by the Windows PowerShell tool.
const NETWORK_COMMAND = /(curl|fetch|axios|wget|invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b)/i;
// Stops at quotes, brackets and shell separators: `(iwr "https://x").Content`
// must give the same endpoint as `irm https://x`.
const FIRST_URL = /https?:\/\/[^\s"'`()<>{}\[\];|,]+/i;

// Endpoint = host and port, without credentials or path:
// an API that is down is rarely down on a single path.
export function extractEndpoint(command) {
  if (!command || !NETWORK_COMMAND.test(command)) return null;
  const urlMatch = command.match(FIRST_URL);
  if (!urlMatch) return null;
  const hostMatch = urlMatch[0].match(/^[A-Za-z]+:\/\/(?:[^@/?#]*@)?([^/?#]+)/);
  if (!hostMatch) return null;
  // Trailing punctuation from prose ("see https://api.x.com.") is not part of the host.
  const host = hostMatch[1].toLowerCase().replace(/[.:]+$/, '');
  return host || null;
}

function currentUserId() {
  if (typeof process.getuid === 'function') return String(process.getuid());
  // Windows has no numeric uid. A hash of the user name keeps state files
  // apart even for non-Latin names, which a character filter would erase.
  let username = process.env.USERNAME || 'unknown';
  try {
    username = userInfo().username || username;
  } catch {
    // Profiles without a user name: keep the environment fallback.
  }
  return createHash('sha256').update(username).digest('hex').slice(0, 12);
}

// State is per user and per session: two parallel sessions never contaminate each other.
export function stateFilePath(sessionId) {
  const session = String(sessionId ?? 'nosession').replace(/[^A-Za-z0-9_-]/g, '') || 'nosession';
  return join(tmpdir(), `claude-circuit-breaker-${currentUserId()}-${session}.json`);
}

export const FAILURE_THRESHOLD = 3;
export const OPEN_WINDOW_SECONDS = 60;
