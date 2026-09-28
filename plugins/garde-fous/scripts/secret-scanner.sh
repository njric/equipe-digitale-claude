#!/bin/bash
# Hook: PreToolUse (Bash)
# Description: Scanne le diff Git lors des git commit/push pour bloquer les
# fuites de secrets RÉELS. Moteur de scan en awk (un seul processus).
#
# Principe : on ne bloque pas sur la simple présence d'un mot-clé
# (token, password... sont des termes métier/de code courants), mais sur :
#   1. des formats de secrets fournisseurs à haute confiance (clé privée, AWS,
#      Stripe, GitHub, Slack, Google, JWT) — partout, NON contournables ;
#   2. l'AFFECTATION d'une valeur (guillemets OPTIONNELS) à une clé sensible
#      (secret, api_key, password, database_url...), filtrée par une heuristique
#      d'entropie. Désactivé sur les fichiers doc/placeholder purs (.example,
#      .md, lockfiles), et contournable au cas par cas via pragma.
#
# Portée selon le verbe :
#   - commit : scanne l'index (git diff --cached) = ce qui va entrer dans l'historique.
#              Si la commande indexe elle-même (`git add ... && git commit`,
#              `git commit -a/-am/--all`), scanne aussi les modifications suivies
#              (git diff HEAD) et, en cas de `git add`, les fichiers non suivis.
#   - push   : scanne @{upstream}..HEAD = les commits locaux pas encore poussés.
#              Rattrape ainsi les commits faits HORS Claude Code (filet de sécurité).
#
# Échappatoire : une ligne TERMINÉE par `# pragma: allowlist secret`
# (ou `// pragma: allowlist secret`) est ignorée — UNIQUEMENT pour l'étage
# "clé = valeur". Les motifs haute confiance restent bloquants malgré le pragma.
#
# Arbitrage disponibilité : ce hook est volontairement "fail-open" sur erreur
# interne (pas de `set -e` global) — une erreur transitoire ne doit jamais
# bloquer un commit légitime. Contrepartie : motifs figés et testés.
#
# Limite de périmètre : en tant que PreToolUse, ce hook ne couvre QUE les
# commandes git passant par Claude Code. Un `git commit` manuel en terminal
# n'est pas vu au commit (mais le sera au prochain push via Claude Code).
# Pour une garantie forte, doubler d'un pre-commit natif ou gitleaks en CI.

if ! command -v jq &> /dev/null; then exit 0; fi
if ! command -v awk &> /dev/null; then exit 0; fi

JSON_INPUT=$(cat)
if [ -z "$JSON_INPUT" ]; then exit 0; fi

COMMAND=$(echo "$JSON_INPUT" | jq -r '.tool_input.command // empty')

# Détection du verbe.
IS_COMMIT=0
IS_PUSH=0
echo "$COMMAND" | grep -qE 'git .*\bcommit\b' && IS_COMMIT=1
echo "$COMMAND" | grep -qE 'git .*\bpush\b'   && IS_PUSH=1
if [ "$IS_COMMIT" -eq 0 ] && [ "$IS_PUSH" -eq 0 ]; then
    exit 0
fi

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    exit 0
fi

# Construction du diff à scanner selon le verbe.
# push prioritaire : si la commande pousse, on inspecte les commits non poussés.
DIFF=""
if [ "$IS_PUSH" -eq 1 ]; then
    # Range : amont configuré .. HEAD. Fail-open si pas d'amont (rien à comparer).
    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)
    if [ -n "$UPSTREAM" ]; then
        DIFF=$(git diff -U0 --diff-filter=ACM "${UPSTREAM}...HEAD" 2>/dev/null)
    else
        # Pas d'amont (première publication de branche) : on scanne tous les
        # commits locaux absents de l'ensemble des remotes.
        DIFF=$(git diff -U0 --diff-filter=ACM $(git rev-list HEAD --not --remotes 2>/dev/null | tail -1)^..HEAD 2>/dev/null)
    fi
else
    # Au moment du PreToolUse, rien n'est encore indexé si la commande indexe
    # elle-même (`git add . && git commit`, `git commit -a/-am/--all`).
    # Dans ces cas, on élargit : modifications suivies + fichiers non suivis.
    HAS_ADD=0
    COMMIT_ALL=0
    echo "$COMMAND" | grep -qE 'git[^;&|]*\badd\b' && HAS_ADD=1
    echo "$COMMAND" | grep -qE 'git[^;&|]*\bcommit\b[^;&|]*([[:space:]]-[a-zA-Z]*a|[[:space:]]--all\b)' && COMMIT_ALL=1

    if [ "$HAS_ADD" -eq 1 ] || [ "$COMMIT_ALL" -eq 1 ]; then
        if git rev-parse --verify -q HEAD > /dev/null 2>&1; then
            DIFF=$(git diff HEAD -U0 --diff-filter=ACM 2>/dev/null)
        else
            DIFF=$(git diff --cached -U0 --diff-filter=ACM 2>/dev/null)
        fi
        if [ "$HAS_ADD" -eq 1 ]; then
            UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null |
                while IFS= read -r f; do
                    git diff --no-index -U0 -- /dev/null "$f" 2>/dev/null
                done)
            DIFF=$(printf '%s\n%s' "$DIFF" "$UNTRACKED")
        fi
    else
        DIFF=$(git diff --cached -U0 --diff-filter=ACM 2>/dev/null)
    fi
fi

[ -z "$DIFF" ] && exit 0

# ---------------------------------------------------------------------------
# Moteur de scan : un seul appel awk traite tout le diff.
# Sortie : lignes "FILE\tCONTENU" pour chaque secret détecté. Vide sinon.
# ---------------------------------------------------------------------------
FINDINGS=$(printf '%s\n' "$DIFF" | awk '
BEGIN {
    # Motifs haute confiance (POSIX ERE). Toujours bloquants, partout.
    # whsec_ (Stripe webhook) ajouté.
    hc[1]  = "-----BEGIN [A-Z ]*PRIVATE KEY-----"
    hc[2]  = "AKIA[0-9A-Z]{16}"
    hc[3]  = "(sk|rk)_live_[0-9A-Za-z]{16,}"
    hc[4]  = "whsec_[0-9A-Za-z]{16,}"
    hc[5]  = "gh[pousr]_[0-9A-Za-z]{20,}"
    hc[6]  = "github_pat_[0-9A-Za-z_]{20,}"
    hc[7]  = "xox[baprse]-[0-9A-Za-z-]{10,}"
    hc[8]  = "AIza[0-9A-Za-z_-]{35}"
    hc[9]  = "eyJ[A-Za-z0-9_=-]{8,}[.][A-Za-z0-9_=-]{8,}[.][A-Za-z0-9_=-]+"
    nhc = 9

    # Clés sensibles (insensible casse, géré par tolower côté test).
    keyre = "(secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret|password|passwd|database_url|mongo_uri|redis_url|private[_-]?key|token)"

    # Allowlist : pragma ancré en fin de ligne.
    allow = "(#|//)[ \t]*pragma:[ \t]*allowlist[ \t]+secret[ \t]*$"

    cur = ""      # fichier courant
    doc = 0       # 1 => fichier doc/template (étage clé=valeur désactivé)
}

# Détection fichier doc/template à partir du path.
function is_doc(f) {
    if (f ~ /(^|\/)\.env\.example$/) return 1
    if (f ~ /\.example$/)            return 1
    if (f ~ /\.(md|mdx)$/)           return 1
    if (f ~ /\.lock$/)               return 1
    if (f ~ /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/) return 1
    return 0
}

# Une valeur ressemble-t-elle à un vrai secret ?
function looks_secret(v,   lv) {
    if (v == "") return 0
    if (length(v) < 12) return 0
    lv = tolower(v)
    # Placeholders / références d environnement.
    if (lv ~ /env\(|process\.env|os\.environ|getenv|\$\{|<[^>]*>|your[_-]|replace|change-?me|example|placeholder|dummy|fake|todo|xxx|\.\.\./) return 0
    # Cas 1 : lettre + (chiffre OU symbole base64/url).
    if (v ~ /[A-Za-z]/ && v ~ /[0-9+\/=_-]/) return 1
    # Cas 2 : longue (>=20) ET casse mixte (passphrase / token alpha).
    if (length(v) >= 20 && v ~ /[A-Z]/ && v ~ /[a-z]/) return 1
    return 0
}

# Extrait et teste les valeurs affectées à une clé sensible dans la ligne.
# Gère valeurs entre guillemets ET valeurs nues (sans guillemets).
function check_assignment(line,   val, m, rest, q, lower) {
    # La ligne doit contenir clé <op> ... pour valoir le coup.
    if (tolower(line) !~ keyre "[\"'"'"' ]*[:=]") return ""

    # a) Valeurs entre guillemets : on capture chaque "..." ou '"'"'...'"'"'.
    rest = line
    while (match(rest, /"[^"]*"|'"'"'[^'"'"']*'"'"'/)) {
        q = substr(rest, RSTART, RLENGTH)
        val = substr(q, 2, length(q) - 2)
        if (looks_secret(val)) return line
        rest = substr(rest, RSTART + RLENGTH)
    }

    # b) Valeur nue : clé = token  (jusquau premier espace / fin / commentaire).
    #    Localisation insensible à la casse sur lower, extraction sur loriginal
    #    aux MÊMES positions (RSTART/RLENGTH sont identiques car tolower ne
    #    change pas la longueur). Évite le bug de casse clé MAJ vs keyre minuscule.
    lower = tolower(line)
    if (match(lower, keyre "[ \t]*[:=]+[ \t]*[^\"'"'"' \t][^ \t#]*")) {
        m = substr(line, RSTART, RLENGTH)   # segment original "CLE=valeur"
        # Retire tout jusquau dernier opérateur :/= du segment pour isoler la valeur.
        sub(/^[^:=]*[:=]+[ \t]*/, "", m)
        if (looks_secret(m)) return line
    }
    return ""
}

{
    line = $0

    # En-tête fichier.
    if (line ~ /^\+\+\+ b\//) {
        cur = substr(line, 7)
        doc = is_doc(cur)
        next
    }
    # Autres en-têtes de diff : ignorés.
    if (line ~ /^(\+\+\+ |--- |diff --git |index |@@|new file|deleted file|rename |similarity |Binary files)/) next

    # On ne traite que les lignes ajoutées réelles (+ suivi dun non-+).
    if (line !~ /^\+[^+]/) next
    if (cur == "") next

    content = substr(line, 2)

    # 1) Haute confiance — partout, AVANT lallowlist.
    for (i = 1; i <= nhc; i++) {
        if (content ~ hc[i]) { print cur "\t" content; next }
    }

    # Allowlist : ne couvre QUE létage clé=valeur.
    if (content ~ allow) next

    # 2) Affectation clé = valeur — sauf fichiers doc/template.
    if (doc == 1) next
    if (check_assignment(content) != "") { print cur "\t" content }
}
')

if [ -z "$FINDINGS" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Rendu des findings sur stderr.
# ---------------------------------------------------------------------------
echo "🚨 ALERTE DE SÉCURITÉ : secret potentiel détecté dans le diff !" >&2
if [ "$IS_PUSH" -eq 1 ]; then
    echo "(scan des commits non encore poussés)" >&2
fi
echo "Expurgez la valeur (ou passez par une variable d'environnement) avant de continuer." >&2
echo "Faux positif (étage clé=valeur uniquement) ? Terminez la ligne par : # pragma: allowlist secret" >&2
echo "----------------------------------------" >&2
printf '%s\n' "$FINDINGS" | while IFS=$'\t' read -r f c; do
    echo "Fichier: $f" >&2
    echo "  $c" >&2
    echo "----------------------------------------" >&2
done

exit 2
