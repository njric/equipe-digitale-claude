#!/bin/bash
# Hook: SessionStart
# Description: Vérifie les dépendances des garde-fous. Les autres hooks sont
# "fail-open" : sans jq, le scanner de secrets se désactive silencieusement.
# Ce contrôle rend cette désactivation visible dès l'ouverture de session.

MISSING=""
for dep in jq git awk; do
    command -v "$dep" > /dev/null 2>&1 || MISSING="$MISSING $dep"
done

[ -z "$MISSING" ] && exit 0

# Pas de jq disponible pour construire le JSON : sortie écrite à la main.
printf '{"systemMessage": "⚠️ Garde-fous équipe INACTIFS : dépendance(s) manquante(s) :%s. Le scanner de secrets et le circuit breaker ne fonctionnent pas. Installation (macOS) : brew install%s"}\n' "$MISSING" "$MISSING"
exit 0
