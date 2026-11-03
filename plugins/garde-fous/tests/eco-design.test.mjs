import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runScript, scriptPath, measureScriptPath, makeRepo, makeTempDir, removeTempDir, git, writeFile, bashInput } from './helpers.mjs';

const createdDirs = [];
after(() => createdDirs.forEach(removeTempDir));

function track(dir) {
  createdDirs.push(dir);
  return dir;
}

// A web repo with a fake origin/HEAD pointing at main, and a feature branch.
function webRepoOnFeatureBranch() {
  const dir = track(makeRepo());
  writeFile(dir, 'package.json', '{}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'web');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  writeFile(dir, 'src/app.js', 'console.log(1);\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'feature');
  return dir;
}

const gate = (dir, command) => runScript(scriptPath('eco-design-pr-gate.mjs'), bashInput(command), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });

test('PR gate blocks gh pr create when plans/impact.md is unchanged', () => {
  const result = gate(webRepoOnFeatureBranch(), 'gh pr create --title x --body-file b.md');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /plans\/impact\.md/);
});

test('PR gate lets the PR through once plans/impact.md is updated', () => {
  const dir = webRepoOnFeatureBranch();
  writeFile(dir, 'plans/impact.md', '# Impact log\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'impact');
  assert.equal(gate(dir, 'gh  pr  create').status, 0);
});

test('PR gate ignores other commands and non-web projects', () => {
  const dir = webRepoOnFeatureBranch();
  assert.equal(gate(dir, 'gh pr list').status, 0);
  const plainRepo = track(makeRepo());
  assert.equal(gate(plainRepo, 'gh pr create').status, 0);
});

test('reminder only fires on web projects', () => {
  const reminder = scriptPath('eco-design-reminder.mjs');
  const input = { hook_event_name: 'SessionStart', session_id: 's' };
  const webDir = track(makeTempDir());
  writeFile(webDir, 'package.json', '{}');
  const onWeb = runScript(reminder, input, { env: { CLAUDE_PROJECT_DIR: webDir } });
  assert.equal(JSON.parse(onWeb.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  const otherDir = track(makeTempDir());
  assert.equal(runScript(reminder, input, { env: { CLAUDE_PROJECT_DIR: otherDir } }).stdout, '');
});

test('check-deps is silent when git is available', () => {
  assert.equal(runScript(scriptPath('check-deps.mjs'), {}).stdout, '');
});

test('check-deps warns when git is missing', () => {
  const result = runScript(scriptPath('check-deps.mjs'), {}, { env: { PATH: '' } });
  assert.match(JSON.parse(result.stdout).systemMessage, /git est introuvable/);
});

const measure = (cwd, ...args) => spawnSync(process.execPath, [measureScriptPath, ...args], { cwd, encoding: 'utf8' });

test('measure-bundle auto-detects dist and reports gzip totals', () => {
  const dir = track(makeTempDir());
  writeFile(dir, 'dist/assets/index-abc.js', 'export const value = 1;\n'.repeat(500));
  writeFile(dir, 'dist/assets/index-abc.js.map', 'x'.repeat(10000));
  writeFile(dir, 'dist/index.html', '<!doctype html><title>t</title>');
  const result = measure(dir, '--json');
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fileCount, 2, 'source maps are excluded');
  assert.ok(report.totalGzipBytes > 0 && report.totalGzipBytes < report.totalRawBytes);
  assert.equal(report.largestFiles[0].path, 'assets/index-abc.js');
  assert.deepEqual(Object.keys(report.byCategory).sort(), ['html', 'js']);
});

test('measure-bundle accepts an explicit directory and prints a text report', () => {
  const dir = track(makeTempDir());
  writeFile(dir, 'public/build/app.css', 'body{margin:0}');
  const result = measure(dir, 'public/build');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Total gzip bytes: \d+/);
});

test('measure-bundle fails clearly when no build output exists', () => {
  const result = measure(track(makeTempDir()));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No build directory found/);
});
