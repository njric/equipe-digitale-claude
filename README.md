# Plugins Claude Code : équipe digitale

## Contenu

`plugins/garde-fous/` : hooks de sécurité communs à l'équipe.

| Hook | Événement | Rôle |
|---|---|---|
| `check-deps.sh` | SessionStart | Avertit si `jq`, `git` ou `awk` manque (les autres hooks se désactivent alors en silence) |
| `secret-scanner.sh` | PreToolUse (Bash) | Bloque un `git commit` ou `git push` contenant un secret |
| `circuit-breaker-block.sh` | PreToolUse (Bash) | Suspend 60 s les appels vers un hôte après 3 échecs consécutifs |
| `circuit-breaker-eval.sh` | PostToolUse et PostToolUseFailure (Bash) | Compte les échecs par hôte (remise à zéro sur succès) |

Prérequis sur chaque poste : `jq` (`brew install jq`).

Le formatage automatique n'est volontairement pas inclus : il dépend de la stack et relève de la configuration de chaque projet.

## Installation (test local)

Dans une session Claude Code :

```
/plugin marketplace add /chemin/vers/equipe-digitale-claude
/plugin install garde-fous@equipe-digitale
```

Puis `/hooks` pour vérifier que les hooks apparaissent sur les quatre événements : SessionStart, PreToolUse, PostToolUse, PostToolUseFailure.

## Déploiement à l'équipe

Une fois ce dossier poussé dans un dépôt git de l'organisation, deux voies :

- activer le plugin pour l'organisation depuis la console d'administration, si l'option est proposée ;
- ou l'ajouter aux paramètres gérés (à vérifier dans la documentation Claude Code avant enregistrement) :

```json
"extraKnownMarketplaces": {
  "equipe-digitale": {
    "source": { "source": "github", "repo": "ORGANISATION/equipe-digitale-claude" }
  }
},
"enabledPlugins": {
  "garde-fous@equipe-digitale": true
}
```

Toute modification du plugin : incrémenter `version` dans `plugins/garde-fous/.claude-plugin/plugin.json`.

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

Fonctionnement : une commande Bash qui échoue (code de sortie non nul) déclenche l'événement PostToolUseFailure, qui incrémente le compteur de l'hôte visé (`hote:port`) ; un succès (PostToolUse) le remet à zéro. Après 3 échecs consécutifs, les appels vers cet hôte sont refusés pendant 60 s, avec un message demandant à Claude de s'arrêter. À l'expiration, un essai est autorisé : s'il échoue, le circuit se rouvre aussitôt. L'état est propre à chaque session (`${TMPDIR}/claude-circuit-breaker-<uid>-<session_id>.json`).

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

### Dépendances

```
PATH=/var/empty /bin/bash "$PWD/plugins/garde-fous/scripts/check-deps.sh"
```

Doit afficher l'avertissement pour `jq`, `git` et `awk`. Ne pas tester avec `PATH=/usr/bin:/bin` : macOS fournit `jq` dans `/usr/bin`, l'avertissement n'apparaîtrait pas.
