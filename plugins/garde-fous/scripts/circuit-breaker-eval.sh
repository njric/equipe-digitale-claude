#!/bin/bash
# Hooks: PostToolUse et PostToolUseFailure (Bash)
# Description: Compte les échecs consécutifs des appels réseau, par endpoint.
# Un code de sortie non nul déclenche PostToolUseFailure (aucun champ exit_code n'est transmis) ;
# un code 0 déclenche PostToolUse. Limite : curl sans -f renvoie 0 sur une erreur HTTP.

if ! command -v jq &> /dev/null; then exit 0; fi

JSON_INPUT=$(cat)
if [ -z "$JSON_INPUT" ]; then exit 0; fi

COMMAND=$(echo "$JSON_INPUT" | jq -r '.tool_input.command // empty')

# Détection d'un appel réseau
if ! echo "$COMMAND" | grep -iqE '(curl|fetch|axios|wget)'; then exit 0; fi

URL=$(echo "$COMMAND" | grep -ioE 'https?://[^ ]+' | head -n 1 | tr -d "\"\'")
if [ -z "$URL" ]; then exit 0; fi

# Endpoint = hôte et port, sans identifiants ni chemin : une API en panne l'est rarement sur un seul chemin
URL=$(echo "$URL" | sed -E 's|^[A-Za-z]+://([^@/?#]*@)?([^/?#]+).*|\2|' | tr 'A-Z' 'a-z')
if [ -z "$URL" ]; then exit 0; fi

# Échec = événement PostToolUseFailure. Une interruption par l'utilisateur ne compte pas.
EVENT=$(echo "$JSON_INPUT" | jq -r '.hook_event_name // empty')
INTERRUPT=$(echo "$JSON_INPUT" | jq -r '.is_interrupt // false')
if [ "$INTERRUPT" = "true" ]; then exit 0; fi

# État propre à l'utilisateur et à la session : deux sessions parallèles ne se contaminent pas
SESSION=$(echo "$JSON_INPUT" | jq -r '.session_id // "nosession"' | tr -cd 'A-Za-z0-9_-')
STATE_FILE="${TMPDIR:-/tmp}/claude-circuit-breaker-$(id -u)-${SESSION}.json"
NOW=$(date +%s)

umask 077
if [ ! -f "$STATE_FILE" ]; then echo "{}" > "$STATE_FILE"; fi

STATE=$(jq -c --arg url "$URL" '.[$url] // {"attempts": 0, "last": 0}' "$STATE_FILE")
ATTEMPTS=$(echo "$STATE" | jq -r '.attempts')

# Sécurité Bash : On s'assure qu'ATTEMPTS est bien numérique avant l'addition
if ! [[ "$ATTEMPTS" =~ ^[0-9]+$ ]]; then
    ATTEMPTS=0
fi

if [ "$EVENT" = "PostToolUseFailure" ]; then
    ATTEMPTS=$((ATTEMPTS + 1))
else
    ATTEMPTS=0
fi

# Sauvegarde atomique
jq --arg url "$URL" --argjson attempts "$ATTEMPTS" --argjson last "$NOW" \
   '.[$url] = {"attempts": $attempts, "last": $last}' "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"

exit 0
