#!/bin/bash
# Hook: PreToolUse (Bash)
# Description: Bloque les appels vers un endpoint HTTP si le circuit est ouvert (>= 3 échecs récents).

if ! command -v jq &> /dev/null; then exit 0; fi

JSON_INPUT=$(cat)
if [ -z "$JSON_INPUT" ]; then exit 0; fi

COMMAND=$(echo "$JSON_INPUT" | jq -r '.tool_input.command // empty')

# Détection rapide de commande réseau
if ! echo "$COMMAND" | grep -iqE '(curl|fetch|axios|wget)'; then exit 0; fi

URL=$(echo "$COMMAND" | grep -ioE 'https?://[^ ]+' | head -n 1 | tr -d "\"\'")
if [ -z "$URL" ]; then exit 0; fi

# Endpoint = hôte et port, sans identifiants ni chemin (même règle que circuit-breaker-eval.sh)
URL=$(echo "$URL" | sed -E 's|^[A-Za-z]+://([^@/?#]*@)?([^/?#]+).*|\2|' | tr 'A-Z' 'a-z')
if [ -z "$URL" ]; then exit 0; fi

# État propre à l'utilisateur et à la session (même chemin que circuit-breaker-eval.sh)
SESSION=$(echo "$JSON_INPUT" | jq -r '.session_id // "nosession"' | tr -cd 'A-Za-z0-9_-')
STATE_FILE="${TMPDIR:-/tmp}/claude-circuit-breaker-$(id -u)-${SESSION}.json"
NOW=$(date +%s)

# Si le fichier n'existe pas, il n'y a pas eu d'échec
if [ ! -f "$STATE_FILE" ]; then exit 0; fi

STATE=$(jq -c --arg url "$URL" '.[$url] // {"attempts": 0, "last": 0}' "$STATE_FILE")
ATTEMPTS=$(echo "$STATE" | jq -r '.attempts')
LAST=$(echo "$STATE" | jq -r '.last')

# État illisible : on laisse passer plutôt que de bloquer à tort
if ! [[ "$ATTEMPTS" =~ ^[0-9]+$ && "$LAST" =~ ^[0-9]+$ ]]; then exit 0; fi

DIFF=$((NOW - LAST))

# Si on a 3 échecs ou plus ET qu'on est dans la fenêtre de 60s
if [ "$ATTEMPTS" -ge 3 ] && [ "$DIFF" -le 60 ]; then
    REMAINING=$((60 - DIFF))
    REASON="🚨 CIRCUIT BREAKER OUVERT : $ATTEMPTS échecs consécutifs détectés vers $URL. L'accès à cet endpoint est suspendu pour encore $REMAINING secondes. Utilise un fallback, analyse les erreurs précédentes ou demande l'avis de l'utilisateur."
    # Refus explicite par décision JSON, plus robuste que le seul code de sortie 2
    jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
    exit 0
fi

exit 0
