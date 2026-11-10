// Hook: PreToolUse (Bash|PowerShell)
// Scans the git diff on `git commit` / `git push` to block leaks of REAL secrets.
//
// Principle: never block on a mere keyword (token, password... are common code
// and business terms), but on:
//   1. high-confidence provider formats (private key, AWS, Stripe, GitHub,
//      Slack, Google, JWT): everywhere, NOT bypassable;
//   2. the ASSIGNMENT of a value (quotes OPTIONAL) to a sensitive key (secret,
//      api_key, password, database_url...), filtered by an entropy heuristic.
//      Disabled on pure doc/placeholder files (.example, .md, lockfiles), and
//      bypassable line by line with the pragma.
//
// Scope per verb:
//   - commit: scans the index (git diff --cached) = what enters history.
//             When the command stages by itself (`git add ... && git commit`,
//             `git commit -a/-am/--all`), also scans tracked changes
//             (git diff HEAD) and, with `git add`, untracked files.
//   - push:   scans @{upstream}..HEAD = local commits not pushed yet. Catches
//             commits made OUTSIDE Claude Code (safety net).
//
// Escape hatch: a line ENDING with `# pragma: allowlist secret` (or
// `// pragma: allowlist secret`) is ignored, ONLY for the key = value stage.
// Adding the pragma is a HUMAN decision: the agent must never add it on its
// own, it shows the flagged line to the user and waits for their decision.
//
// Availability trade-off: fail-open on internal error (runHook), a transient
// error must never block a legitimate commit.
//
// Scope limit: as a PreToolUse hook, only git commands run through Claude Code
// are seen. A manual commit in a terminal is caught at the next push through
// Claude Code. For a strong guarantee, add a native pre-commit or gitleaks in CI.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runHook, projectDir, tryGit, blockWithMessage } from './lib/hook-io.mjs';

const HIGH_CONFIDENCE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /(sk|rk)_live_[0-9A-Za-z]{16,}/,
  /whsec_[0-9A-Za-z]{16,}/,
  /gh[pousr]_[0-9A-Za-z]{20,}/,
  /github_pat_[0-9A-Za-z_]{20,}/,
  /xox[baprse]-[0-9A-Za-z-]{10,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /eyJ[A-Za-z0-9_=-]{8,}[.][A-Za-z0-9_=-]{8,}[.][A-Za-z0-9_=-]+/,
];

const SENSITIVE_KEY = '(secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret|password|passwd|database_url|mongo_uri|redis_url|private[_-]?key|token)';
const KEY_FOLLOWED_BY_OPERATOR = new RegExp(SENSITIVE_KEY + `["' ]*[:=]`);
const KEY_WITH_BARE_VALUE = new RegExp(SENSITIVE_KEY + `[ \\t]*[:=]+[ \\t]*[^"' \\t][^ \\t#]*`);
const QUOTED_VALUE = /"[^"]*"|'[^']*'/g;
const ALLOWLIST_PRAGMA = /(#|\/\/)[ \t]*pragma:[ \t]*allowlist[ \t]+secret[ \t]*$/;
const PLACEHOLDER = /env\(|process\.env|os\.environ|getenv|\$\{|<[^>]*>|your[_-]|replace|change-?me|example|placeholder|dummy|fake|todo|xxx|\.\.\./;

function isDocFile(path) {
  return /\.example$/.test(path)
    || /\.(md|mdx)$/.test(path)
    || /\.lock$/.test(path)
    || /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/.test(path);
}

function looksSecret(value) {
  if (!value || value.length < 12) return false;
  if (PLACEHOLDER.test(value.toLowerCase())) return false;
  // Environment variable NAME (e.g. "GITHUB_TOKEN"), not its value.
  // Only the name is skipped: a hard-coded default such as
  // os.environ.get("X", "realSecret123") is still detected.
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value)) return false;
  // Case 1: a letter plus a digit or a base64/url symbol.
  if (/[A-Za-z]/.test(value) && /[0-9+/=_-]/.test(value)) return true;
  // Case 2: long and mixed case (passphrase, alphabetic token).
  return value.length >= 20 && /[A-Z]/.test(value) && /[a-z]/.test(value);
}

function hasSecretAssignment(line) {
  const lowerLine = line.toLowerCase();
  if (!KEY_FOLLOWED_BY_OPERATOR.test(lowerLine)) return false;

  for (const quoted of line.match(QUOTED_VALUE) ?? []) {
    if (looksSecret(quoted.slice(1, -1))) return true;
  }

  // Bare value: located on the lowercased line, extracted from the original
  // line at the same offsets (toLowerCase keeps ASCII offsets unchanged).
  const bareMatch = KEY_WITH_BARE_VALUE.exec(lowerLine);
  if (bareMatch) {
    const segment = line.slice(bareMatch.index, bareMatch.index + bareMatch[0].length);
    if (looksSecret(segment.replace(/^[^:=]*[:=]+[ \t]*/, ''))) return true;
  }
  return false;
}

function parseFileHeader(line) {
  // git quotes paths containing unusual characters: +++ "b/my file.js"
  const match = line.match(/^\+\+\+ "?b\/(.*?)"?$/);
  return match ? match[1] : null;
}

// Headers are only parsed before the first hunk of each file: inside a hunk,
// every line starting with '+' is added content, even "+++ x" or "++ notes".
function scanDiff(diff) {
  const findings = [];
  let currentFile = '';
  let currentIsDoc = false;
  let inHunk = false;

  for (const rawLine of diff.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      currentFile = '';
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('+++ ')) {
        currentFile = parseFileHeader(line) ?? '';
        currentIsDoc = isDocFile(currentFile);
      } else if (line.startsWith('@@')) {
        inHunk = true;
      }
      continue;
    }
    if (!line.startsWith('+') || !currentFile) continue;

    const content = line.slice(1);
    // 1) High confidence: everywhere, BEFORE the allowlist.
    if (HIGH_CONFIDENCE_PATTERNS.some((pattern) => pattern.test(content))) {
      findings.push({ file: currentFile, content });
      continue;
    }
    // The allowlist only covers the key = value stage.
    if (ALLOWLIST_PRAGMA.test(content) || currentIsDoc) continue;
    if (hasSecretAssignment(content)) findings.push({ file: currentFile, content });
  }
  return findings;
}

// Explicit prefixes and no color: user settings (diff.mnemonicPrefix,
// color.ui=always, external diff tools) must not break header parsing.
const DIFF_OPTIONS = ['-U0', '--diff-filter=ACM', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];

// Top level of the repository Claude is working in, set at hook start.
let repoDir = '';
const gitInRepo = (args) => tryGit(args, { cwd: repoDir });

function emptyTreeHash() {
  // Computed rather than hard-coded: the hash differs in SHA-256 repositories.
  return execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], {
    cwd: repoDir, input: '', encoding: 'utf8',
  }).trim();
}

function unpushedDiff() {
  const upstream = gitInRepo(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])?.trim();
  if (upstream) return gitInRepo(['diff', ...DIFF_OPTIONS, `${upstream}...HEAD`]) ?? '';

  // No upstream (first publication of the branch): every local commit missing
  // from all remotes.
  const unpushedCommits = (gitInRepo(['rev-list', 'HEAD', '--not', '--remotes']) ?? '').trim().split('\n').filter(Boolean);
  if (unpushedCommits.length === 0) return '';
  const oldestCommit = unpushedCommits[unpushedCommits.length - 1];
  const parent = gitInRepo(['rev-parse', '--verify', '-q', `${oldestCommit}^`])?.trim();
  // Root commit (brand-new repository): compare with the empty tree.
  return gitInRepo(['diff', ...DIFF_OPTIONS, parent || emptyTreeHash(), 'HEAD']) ?? '';
}

// Untracked files rendered as a diff where every line is added.
function untrackedFilesAsDiff() {
  const listing = gitInRepo(['ls-files', '-z', '--others', '--exclude-standard']) ?? '';
  return listing.split('\0').filter(Boolean).map((relativePath) => {
    let buffer;
    try {
      buffer = readFileSync(join(repoDir, relativePath));
    } catch {
      return '';
    }
    // Same rule as git: a NUL byte in the first 8000 bytes means binary.
    if (buffer.subarray(0, 8000).includes(0)) return '';
    const addedLines = buffer.toString('utf8').split('\n').map((fileLine) => `+${fileLine}`);
    return [`diff --git a/${relativePath} b/${relativePath}`, `+++ b/${relativePath}`, '@@ untracked @@', ...addedLines].join('\n');
  }).join('\n');
}

function commitDiff(command) {
  // At PreToolUse time nothing is staged yet when the command stages by itself.
  const stagesWithAdd = /git[^;&|]*\badd\b/.test(command);
  const commitsAll = /git[^;&|]*\bcommit\b[^;&|]*(\s-[a-zA-Z]*a|\s--all\b)/.test(command);
  if (!stagesWithAdd && !commitsAll) return gitInRepo(['diff', '--cached', ...DIFF_OPTIONS]) ?? '';

  const hasHead = gitInRepo(['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  let diff = gitInRepo(hasHead ? ['diff', 'HEAD', ...DIFF_OPTIONS] : ['diff', '--cached', ...DIFF_OPTIONS]) ?? '';
  if (stagesWithAdd) diff += '\n' + untrackedFilesAsDiff();
  return diff;
}

runHook((input) => {
  const command = input.tool_input?.command ?? '';
  const isCommit = /git .*\bcommit\b/.test(command);
  const isPush = /git .*\bpush\b/.test(command);
  if (!isCommit && !isPush) return;

  // The session's current directory (input.cwd) may be a sub-repository of
  // the project: scan the repository git will actually commit to.
  const topLevel = tryGit(['rev-parse', '--show-toplevel'], { cwd: input.cwd || projectDir() })?.trim();
  if (!topLevel) return;
  repoDir = topLevel;

  // Push takes precedence: when the command pushes, inspect unpushed commits.
  const diff = isPush ? unpushedDiff() : commitDiff(command);
  if (!diff.trim()) return;

  const findings = scanDiff(diff);
  if (findings.length === 0) return;

  const separator = '----------------------------------------';
  blockWithMessage([
    '🚨 ALERTE DE SÉCURITÉ : secret potentiel détecté dans le diff !',
    ...(isPush ? ['(scan des commits non encore poussés)'] : []),
    "Expurgez la valeur (ou passez par une variable d'environnement) avant de continuer.",
    "Faux positif probable ? Ne modifiez PAS la ligne : montrez-la à l'utilisateur et attendez sa décision.",
    "Seul l'utilisateur peut décider d'ajouter '# pragma: allowlist secret' (étage clé=valeur uniquement).",
    separator,
    ...findings.flatMap(({ file, content }) => [`Fichier: ${file}`, `  ${content}`, separator]),
  ]);
});
