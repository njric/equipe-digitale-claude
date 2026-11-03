// Hook: SessionStart
// The other hooks are fail-open: without git, the secret scanner silently does
// nothing. This check makes that visible as soon as the session opens.
// Node itself needs no check: without it, Claude Code reports every hook as failing.

import { printJson, tryGit } from './lib/hook-io.mjs';

const INSTALL_HINT_BY_PLATFORM = {
  darwin: 'brew install git (ou xcode-select --install)',
  win32: 'winget install Git.Git',
};

// process.cwd(): the project directory may not exist yet, which would look like a missing git.
if (tryGit(['--version'], { cwd: process.cwd() }) === null) {
  const hint = INSTALL_HINT_BY_PLATFORM[process.platform] ?? 'installer git avec le gestionnaire de paquets du système';
  printJson({
    systemMessage:
      '⚠️ Garde-fous équipe partiellement INACTIFS : git est introuvable. ' +
      `Le scanner de secrets et la vérification d'impact avant PR ne fonctionnent pas. Installation : ${hint}`,
  });
}
