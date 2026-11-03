import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const scriptPath = (name) => join(pluginRoot, 'scripts', name);
export const measureScriptPath = join(pluginRoot, 'skills', 'eco-design', 'scripts', 'measure-bundle.mjs');

// Isolate tests from the developer's own git configuration (hooks, signing...).
const isolatedGitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

export function runScript(script, input, { cwd, env = {} } = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    input: input === undefined ? '' : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...isolatedGitEnv, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'garde-fous-test-'));
}

export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedGitEnv, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function makeRepo() {
  const dir = makeTempDir();
  git(dir, 'init', '-q', '-b', 'main');
  writeFile(dir, 'README.md', '# test\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export function writeFile(dir, relativePath, content) {
  const target = join(dir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export const bashInput = (command, extra = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  session_id: 'test-session',
  tool_input: { command },
  ...extra,
});
