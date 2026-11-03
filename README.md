# Plugins Claude Code : équipe digitale

## Contenu

`plugins/garde-fous/` : hooks de sécurité communs à l'équipe et skill d'éco-conception. Fonctionne sur macOS et Windows.

| Hook (`scripts/`) | Événement | Rôle |
|---|---|---|
| `check-deps.mjs` | SessionStart | Avertit si `git` manque (le scanner de secrets se désactive alors en silence) |
| `eco-design-reminder.mjs` | SessionStart | Rappelle le skill eco-design sur les projets web (`package.json`) |
| `secret-scanner.mjs` | PreToolUse (Bash, PowerShell) | Bloque un `git commit` ou `git push` contenant un secret |
| `eco-design-pr-gate.mjs` | PreToolUse (Bash, PowerShell) | Bloque `gh pr create` sur un projet web si `plans/impact.md` n'a pas été mis à jour |
| `circuit-breaker-block.mjs` | PreToolUse (Bash, PowerShell) | Suspend 60 s les appels vers un hôte après 3 échecs consécutifs |
| `circuit-breaker-eval.mjs` | PostToolUse et PostToolUseFailure (Bash, PowerShell) | Compte les échecs par hôte (remise à zéro sur succès) |

Le skill `eco-design` fournit `skills/eco-design/scripts/measure-bundle.mjs`, qui mesure la taille brute et gzip du build (`dist`, `build`, `out` ou `.next/static`) pour la revue d'impact avant PR.

### Prérequis sur chaque poste

- **Node.js ≥ 18** sur le `PATH` : tous les hooks sont des scripts Node, sans dépendance npm. Sans Node, Claude Code signale chaque hook en erreur (non bloquant).
  - macOS : `brew install node`
  - Windows : `winget install OpenJS.NodeJS.LTS`
- **git** : `brew install git` / `winget install Git.Git`.

`jq` et `awk` ne sont plus nécessaires.

### Windows

Les hooks sont lancés en forme exec (`node <script>`), donc sans shell : ils fonctionnent avec ou sans Git Bash. Les matchers couvrent l'outil `Bash` (Git Bash) et l'outil `PowerShell`. Le circuit breaker reconnaît aussi `Invoke-WebRequest`, `Invoke-RestMethod`, `iwr` et `irm`.

Le formatage automatique n'est volontairement pas inclus : il dépend de la stack et relève de la configuration de chaque projet.

## Installation (test local)

Dans une session Claude Code :

```
/plugin marketplace add /chemin/vers/equipe-digitale-claude
/plugin install garde-fous@equipe-digitale
```

Puis `/hooks` pour vérifier que les hooks apparaissent sur les quatre événements : SessionStart, PreToolUse, PostToolUse, PostToolUseFailure.

## Vérifications

### Scanner de secrets

Dans un dépôt de test, créer un fichier contenant une fausse clé :

```
echo 'AWS_KEY=AKIAABCDEFGHIJKLMNOP' > test.js
```

Demander à Claude : « fais un git add . && git commit ». Le commit doit être bloqué.

Cas couverts : index classique, `git add ... && git commit`, `git commit -a/-am/--all`, fichiers non suivis (hors `.gitignore`), push des commits non poussés.

Échappatoire pour un faux positif de type clé = valeur : terminer la ligne par `# pragma: allowlist secret`.

### Circuit breaker

Fonctionnement : une commande Bash qui échoue (code de sortie non nul) déclenche l'événement PostToolUseFailure, qui incrémente le compteur de l'hôte visé (`hote:port`) ; un succès (PostToolUse) le remet à zéro. Après 3 échecs consécutifs, les appels vers cet hôte sont refusés pendant 60 s, avec un message demandant à Claude de s'arrêter. À l'expiration, un essai est autorisé : s'il échoue, le circuit se rouvre aussitôt. L'état est propre à chaque utilisateur et à chaque session (`claude-circuit-breaker-<uid ou nom d'utilisateur>-<session_id>.json` dans le répertoire temporaire du système).

Test : demander à Claude d'exécuter, **en quatre appels Bash distincts, sans boucle ni enchaînement** :

```
curl -fsS -o /dev/null https://httpbin.org/status/500
curl -fsS -o /dev/null https://httpbin.org/status/502
curl -fsS -o /dev/null https://httpbin.org/status/503
curl -fsS -o /dev/null https://httpbin.org/status/200
```

Le 4e appel doit être refusé avec le message du circuit breaker.

Limites connues :

- `curl` renvoie 0 sur une erreur HTTP (404, 500) sans l'option `-f` : l'appel est alors vu comme un succès. Utiliser `curl -f` ou `curl --fail-with-body` pour tout appel dont le statut HTTP compte.
- Le comptage porte sur les appels d'outil, pas sur les requêtes : plusieurs `curl` dans une même commande (boucle, `;`, `&&`) comptent pour un seul échec.
- Tous les chemins d'un même hôte partagent le compteur, y compris en local : trois échecs sur `localhost:3000` suspendent tout le serveur 60 s.

### Tests automatisés

```
node --test plugins/garde-fous/tests/
```

Couvrent le scanner de secrets (dans des dépôts git temporaires), le circuit breaker, la vérification d'impact avant PR, le rappel éco-conception, `check-deps` et le script de mesure. À lancer sur macOS **et** sur Windows avant toute nouvelle version.

### Checklist Windows (à faire sur un poste Windows)

1. `node --test plugins/garde-fous/tests/` : tous les tests passent.
2. Installer le plugin, puis `/hooks` : les hooks apparaissent sur les quatre événements.
3. Avec Git Bash installé : refaire le test du scanner de secrets et celui du circuit breaker ci-dessus.
4. Avec l'outil PowerShell (par défaut sans Git Bash, ou `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`) : demander à Claude `git add -A; git commit -m test` avec la fausse clé, le commit doit être bloqué. Puis 4 appels `Invoke-WebRequest https://httpbin.org/status/500`, le 4e doit être refusé.
5. Sur un projet web : `node "<chemin du plugin>/skills/eco-design/scripts/measure-bundle.mjs"` après `npm run build` affiche le total gzip.
