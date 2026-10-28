#!/bin/bash
# Hook: PreToolUse (Bash)
# Description: Blocks PR creation on web projects when plans/impact.md
# was not updated on the branch (eco-design impact review missing).
# Fail-open on internal errors, like secret-scanner.

# 1. Fail-open si jq n'est pas installé
command -v jq >/dev/null 2>&1 || exit 0

JSON_INPUT=$(cat)

# 2. Extraction sécurisée de la commande
COMMAND=$(printf '%s\n' "$JSON_INPUT" | jq -r '.tool_input.command // empty')

# Utilisation de \s+ pour gérer les espaces multiples et <<< pour éviter les failles echo
grep -qE '\bgh[[:space:]]+pr[[:space:]]+create\b' <<< "$COMMAND" || exit 0

# 3. Changement de répertoire sécurisé
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f package.json ] || exit 0

# 4. Récupération de la base
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)

# 5. Diff ('--' tells git that what precedes is a revision, not a file path)
CHANGED=$(git diff --name-only "${BASE}...HEAD" -- 2>/dev/null) || exit 0

# Utilisation de <<< au lieu de echo pour empêcher l'interprétation des noms de fichiers (ex: "-e")
grep -qxF 'plans/impact.md' <<< "$CHANGED" && exit 0

printf "🌱 Impact review missing: plans/impact.md was not updated on this branch.\n" >&2
printf "Run the eco-design skill's impact review before opening the Pull Request.\n" >&2
exit 2
