// Web project detection shared by the eco-design hooks.
// The team builds small Node apps, often generated as frontend/ + backend/
// folders: a package.json at the root OR in a first-level folder counts.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Dependency and tooling folders hold package.json files that say nothing
// about the project itself.
const IGNORED_FOLDERS = new Set(['node_modules', 'vendor', 'dist', 'build']);

export function isWebProject(dir) {
  if (existsSync(join(dir, 'package.json'))) return true;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory()
    && !entry.name.startsWith('.')
    && !IGNORED_FOLDERS.has(entry.name)
    && existsSync(join(dir, entry.name, 'package.json')));
}
