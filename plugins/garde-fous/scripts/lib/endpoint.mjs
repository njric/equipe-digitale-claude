// Network-call detection shared by circuit-breaker-block and circuit-breaker-eval,
// so both hooks always agree on which endpoint a command targets.

import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

// Includes the PowerShell equivalents of curl, used by the Windows PowerShell tool.
const NETWORK_COMMAND = /(curl|fetch|axios|wget|invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b)/i;
const FIRST_URL = /https?:\/\/[^\s]+/i;

// Endpoint = host and port, without credentials or path:
// an API that is down is rarely down on a single path.
export function extractEndpoint(command) {
  if (!command || !NETWORK_COMMAND.test(command)) return null;
  const urlMatch = command.match(FIRST_URL);
  if (!urlMatch) return null;
  const url = urlMatch[0].replace(/["']/g, '');
  const hostMatch = url.match(/^[A-Za-z]+:\/\/(?:[^@/?#]*@)?([^/?#]+)/);
  return hostMatch ? hostMatch[1].toLowerCase() : null;
}

function currentUserId() {
  if (typeof process.getuid === 'function') return String(process.getuid());
  // Windows has no numeric uid: the user name keeps state files apart.
  return userInfo().username.replace(/[^A-Za-z0-9_-]/g, '');
}

// State is per user and per session: two parallel sessions never contaminate each other.
export function stateFilePath(sessionId) {
  const session = String(sessionId ?? 'nosession').replace(/[^A-Za-z0-9_-]/g, '') || 'nosession';
  return join(tmpdir(), `claude-circuit-breaker-${currentUserId()}-${session}.json`);
}

export const FAILURE_THRESHOLD = 3;
export const OPEN_WINDOW_SECONDS = 60;
