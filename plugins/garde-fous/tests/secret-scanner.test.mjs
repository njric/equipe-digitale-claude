import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, scriptPath, makeRepo, removeTempDir, git, writeFile, bashInput } from './helpers.mjs';

const scanner = scriptPath('secret-scanner.mjs');
const createdRepos = [];
after(() => createdRepos.forEach(removeTempDir));

function newRepo() {
  const dir = makeRepo();
  createdRepos.push(dir);
  return dir;
}

// Fake secrets are assembled at runtime so this file never trips the scanner itself.
const FAKE_AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const FAKE_ASSIGNMENT = 'pass' + 'word = "Zx9' + 'qLm2_VbT7wPa"';

const scan = (dir, command) => runScript(scanner, bashInput(command), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });

test('ignores commands that are neither commit nor push', () => {
  const dir = newRepo();
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git status').status, 0);
});

test('blocks a staged high-confidence secret on commit', () => {
  const dir = newRepo();
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  git(dir, 'add', '.');
  const result = scan(dir, 'git commit -m "x"');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Fichier: a\.js/);
});

test('blocks an untracked file staged by the same command (git add . && git commit)', () => {
  const dir = newRepo();
  writeFile(dir, 'src/config.js', `export const k = "${FAKE_AWS_KEY}";\n`);
  assert.equal(scan(dir, 'git add . && git commit -m "x"').status, 2);
});

test('blocks a tracked modification committed with -am', () => {
  const dir = newRepo();
  writeFile(dir, 'app.py', 'x = 1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'app');
  writeFile(dir, 'app.py', `x = 1\n${FAKE_ASSIGNMENT}\n`);
  assert.equal(scan(dir, 'git commit -am "x"').status, 2);
});

test('handles CRLF line endings', () => {
  const dir = newRepo();
  writeFile(dir, 'win.js', `a = 1\r\n${FAKE_ASSIGNMENT}\r\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 2);
});

test('the pragma allowlists a key = value line', () => {
  const dir = newRepo();
  writeFile(dir, 'app.py', `${FAKE_ASSIGNMENT}  # pragma: allowlist secret\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 0);
});

test('the pragma does not allowlist a high-confidence secret', () => {
  const dir = newRepo();
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}"; // pragma: allowlist secret\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 2);
});

test('key = value is ignored in markdown files', () => {
  const dir = newRepo();
  writeFile(dir, 'docs/setup.md', `${FAKE_ASSIGNMENT}\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 0);
});

test('placeholders are not reported', () => {
  const dir = newRepo();
  writeFile(dir, 'app.js', 'const pass' + 'word = process.env.DB_PASSWORD_VALUE;\n');
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 0);
});

test('push without upstream scans every unpushed commit, root commit included', () => {
  const dir = newRepo();
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'leak');
  const result = scan(dir, 'git push -u origin main');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /commits non encore poussés/);
});

test('detects git commands sent through the PowerShell tool', () => {
  const dir = newRepo();
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  const input = { ...bashInput('git add -A; git commit -m "x"'), tool_name: 'PowerShell' };
  assert.equal(runScript(scanner, input, { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }).status, 2);
});

test('a content line starting with "++ " does not hide the rest of the file', () => {
  const dir = newRepo();
  writeFile(dir, 'notes.txt', `++ notes\n+++ fixture\n${FAKE_ASSIGNMENT}\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 2);
  // Same file left untracked and staged by the command itself.
  const untrackedDir = newRepo();
  writeFile(untrackedDir, 'notes.txt', `++ notes\n${FAKE_ASSIGNMENT}\n`);
  assert.equal(scan(untrackedDir, 'git add . && git commit -m "x"').status, 2);
});

test('a content line starting with "+" is scanned', () => {
  const dir = newRepo();
  writeFile(dir, 'list.yml', `keys:\n+${FAKE_AWS_KEY}\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 2);
  const untrackedDir = newRepo();
  writeFile(untrackedDir, 'list.yml', `+${FAKE_AWS_KEY}\n`);
  assert.equal(scan(untrackedDir, 'git add . && git commit -m "x"').status, 2);
});

test('scans the repository of the session cwd, not only the project root', () => {
  const projectRoot = newRepo();
  const subRepo = newRepo();
  writeFile(subRepo, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  writeFile(subRepo, 'src/index.js', '// app\n');
  const input = bashInput('git add . && git commit -m "x"', { cwd: `${subRepo}/src` });
  const result = runScript(scanner, input, { cwd: projectRoot, env: { CLAUDE_PROJECT_DIR: projectRoot } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Fichier: a\.js/);
});

test('user diff settings do not break the scan', () => {
  const dir = newRepo();
  git(dir, 'config', 'diff.mnemonicPrefix', 'true');
  git(dir, 'config', 'color.ui', 'always');
  writeFile(dir, 'a.js', `const k = "${FAKE_AWS_KEY}";\n`);
  git(dir, 'add', '.');
  assert.equal(scan(dir, 'git commit -m "x"').status, 2);
});

test('fails open outside a git repository and on invalid input', () => {
  const dir = newRepo();
  removeTempDir(`${dir}/.git`);
  assert.equal(scan(dir, 'git commit -m "x"').status, 0);
  assert.equal(runScript(scanner, undefined, { cwd: dir }).status, 0);
});
