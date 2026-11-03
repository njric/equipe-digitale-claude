import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { runScript, scriptPath, bashInput } from './helpers.mjs';

const blockScript = scriptPath('circuit-breaker-block.mjs');
const evalScript = scriptPath('circuit-breaker-eval.mjs');
const sessions = [];

after(() => {
  // Same naming rule as lib/endpoint.mjs; only this test's own state files are removed.
  const user = typeof process.getuid === 'function'
    ? String(process.getuid())
    : userInfo().username.replace(/[^A-Za-z0-9_-]/g, '');
  for (const session of sessions) {
    rmSync(join(tmpdir(), `claude-circuit-breaker-${user}-${session}.json`), { force: true });
  }
});

function newSession() {
  const session = `cbtest-${process.pid}-${sessions.length}`;
  sessions.push(session);
  return session;
}

const failure = (command, session) => runScript(evalScript, bashInput(command, { hook_event_name: 'PostToolUseFailure', session_id: session }));
const success = (command, session) => runScript(evalScript, bashInput(command, { hook_event_name: 'PostToolUse', session_id: session }));
const preCheck = (command, session) => runScript(blockScript, bashInput(command, { session_id: session }));
const isDenied = (result) => result.stdout.includes('"permissionDecision":"deny"');

test('opens the circuit after 3 consecutive failures on the same host', () => {
  const session = newSession();
  failure('curl -fsS https://api.example.test/a', session);
  failure('curl -fsS https://api.example.test/b', session);
  assert.equal(isDenied(preCheck('curl https://api.example.test/c', session)), false);
  failure('curl -fsS https://API.example.test/c', session);
  const result = preCheck('curl https://api.example.test/d', session);
  assert.equal(result.status, 0);
  assert.equal(isDenied(result), true);
  assert.match(result.stdout, /api\.example\.test/);
});

test('a success resets the counter', () => {
  const session = newSession();
  for (let i = 0; i < 3; i += 1) failure('curl -f https://reset.example.test', session);
  success('curl -f https://reset.example.test', session);
  assert.equal(isDenied(preCheck('curl https://reset.example.test', session)), false);
});

test('hosts and sessions are independent', () => {
  const session = newSession();
  for (let i = 0; i < 3; i += 1) failure('curl -f https://down.example.test', session);
  assert.equal(isDenied(preCheck('curl https://other.example.test', session)), false);
  assert.equal(isDenied(preCheck('curl https://down.example.test', newSession())), false);
});

test('user interruptions are not counted', () => {
  const session = newSession();
  for (let i = 0; i < 3; i += 1) {
    runScript(evalScript, bashInput('curl https://int.example.test', { hook_event_name: 'PostToolUseFailure', session_id: session, is_interrupt: true }));
  }
  assert.equal(isDenied(preCheck('curl https://int.example.test', session)), false);
});

test('PowerShell web cmdlets are tracked', () => {
  const session = newSession();
  for (let i = 0; i < 3; i += 1) failure('Invoke-WebRequest -Uri "https://ps.example.test:8443/x"', session);
  assert.equal(isDenied(preCheck('irm https://ps.example.test:8443/y', session)), true);
});

test('non-network commands are ignored', () => {
  assert.equal(preCheck('ls https://not-a-call.example.test', newSession()).stdout, '');
});
