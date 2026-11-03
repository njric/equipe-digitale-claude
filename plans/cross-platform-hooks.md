# Plugin garde-fous : script de mesure éco-conception + hooks multiplateformes

## Contexte

Le plugin `plugins/garde-fous` (v1.2.1) a deux défauts :
1. Le skill `eco-design` (§3 étape 1) demande à Claude d'écrire **à chaque fois** un petit script qui additionne la taille gzip du build. Il faut le livrer dans le plugin.
2. Les 6 hooks sont des scripts bash qui dépendent de `jq` (absent de Windows, même avec Git Bash), de `id -u`, de `$TMPDIR`, de `/dev/null`, et de `brew` dans les messages. Le matcher `Bash` ignore aussi l'outil `PowerShell`, actif par défaut sous Windows. Sous Windows sans Git Bash, les hooks partent dans PowerShell et ne tournent pas du tout.

## Décision : une seule version, en Node.js (pas deux déclinaisons)

- **Une seule base de code** : deux versions (bash + PowerShell) doubleraient la maintenance du scanner de secrets, qui est le script le plus sensible. Les deux finiraient par diverger.
- La doc Claude Code recommande pour les plugins multiplateformes la **forme exec** (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/…"]`). Elle marche partout, sans souci de shell, de guillemets ou de backslash.
- **`jq` et `awk` ne sont plus nécessaires** : Node lit le JSON nativement. Seuls prérequis : `node` et `git`.
- Contrepartie : `node` doit être installé (Claude Code natif n'en a pas besoin). C'est acceptable pour une équipe digitale qui fait du web. Si `node` manque, Claude Code affiche une erreur de hook, non bloquante et visible. Le README le documentera.
- Matcher `Bash|PowerShell` pour couvrir l'outil PowerShell de Windows (même champ `tool_input.command`).

## Structure cible

```
plugins/garde-fous/
  hooks/hooks.json                 # forme exec, node, matcher Bash|PowerShell
  scripts/
    lib/hook-io.mjs                # lecture stdin JSON, helpers deny/exit 2, fail-open (try/catch global)
    lib/endpoint.mjs               # détection appel réseau + extraction hôte:port (partagé block/eval)
    check-deps.mjs
    secret-scanner.mjs
    circuit-breaker-block.mjs
    circuit-breaker-eval.mjs
    eco-design-pr-gate.mjs
    eco-design-reminder.mjs
  skills/eco-design/
    SKILL.md                       # §3 étape 1 réécrite
    scripts/measure-bundle.mjs     # nouveau
  tests/*.test.mjs                 # node:test, sans dépendance
```
Les `.sh` sont supprimés (git rm), à remplacer, pas à garder en double.

## 1. Script de mesure `measure-bundle.mjs` (zéro dépendance)

- Usage : `node "${CLAUDE_SKILL_DIR}/scripts/measure-bundle.mjs" [dossier] [--json]`.
- Sans dossier, détecte le premier qui existe parmi `dist`, `build`, `out`, `.next/static`.
- Parcourt les fichiers récursivement et calcule pour chacun la taille brute et la taille gzip (`zlib.gzipSync`, niveau 9). Ignore les `.map` et les fichiers déjà compressés (`.gz`, `.br`).
- Sortie : total brut, total gzip, répartition par type (js/css/html/images/fonts/autres), top 10 des fichiers. `--json` donne une sortie machine.
- Code de sortie ≠ 0 avec un message clair si aucun dossier de build n'est trouvé.
- SKILL.md §3.1 : « Run `npm run build`, then run the bundled script… Use its gzip total for the Bundle size table. » Le paragraphe « write a small script in $TMPDIR » est supprimé. À vérifier à l'implémentation : la substitution `${CLAUDE_SKILL_DIR}` dans le contenu du skill. Sinon, se rabattre sur `${CLAUDE_PLUGIN_ROOT}/skills/eco-design/scripts/…`.

## 2. Portage des hooks (comportement identique, rien de plus)

Points de portage notables :
- **hook-io** : `fs.readFileSync(0)` puis `JSON.parse`. Toute exception donne `exit 0` (fail-open conservé). Blocage par `stderr` + `exit 2`, ou par JSON `permissionDecision: "deny"` comme aujourd'hui.
- **git** : `execFileSync('git', [...], { cwd: CLAUDE_PROJECT_DIR ?? cwd })`, sans shell, donc pas de problème de guillemets sous Windows.
- **secret-scanner** : on reprend tels quels les 9 motifs haute confiance, `keyre`, `looks_secret`, `is_doc`, le pragma et la logique commit/push/`add`/`-a`. Les fichiers non suivis sont lus directement par Node (toutes les lignes comptent comme ajoutées), au lieu de `git diff --no-index /dev/null`. Gestion des fins de ligne CRLF (`\r` retiré).
- **circuit breaker** : état dans `os.tmpdir()/claude-circuit-breaker-<user>-<session>.json`. `<user>` vaut `process.getuid?.()`, ou à défaut `os.userInfo().username` assaini. Écriture atomique par fichier `.tmp` puis `renameSync`. Mêmes seuils (3 échecs, 60 s).
- **Détection réseau** : on ajoute aux motifs actuels (`curl|fetch|axios|wget`) les commandes PowerShell `Invoke-WebRequest|Invoke-RestMethod|iwr|irm`. La même regex d'URL et le même calcul de l'hôte s'appliquent.
- **eco-design-pr-gate / reminder** : portage direct.
- **check-deps** : vérifie seulement `git` (via `execFileSync('git',['--version'])`). Le message d'installation dépend de la plateforme : `brew install git` sous macOS, `winget install Git.Git` sous Windows.

`hooks.json` : chaque entrée devient `{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/xxx.mjs"] }`, avec les matchers `Bash|PowerShell`.

## 3. Docs et version

- README : tableau des hooks (`.mjs`), prérequis `node` ≥ 18 + `git` (plus de `jq`), section Windows (Git Bash facultatif, outil PowerShell couvert), nouvelle commande de test de `check-deps`, mention du script de mesure.
- `plugin.json` et `marketplace.json` passent à la version **1.3.0**. La description du plugin mentionne l'éco-conception.

## Méthode

- Branche `feature/cross-platform-hooks` (pas de travail sur master).
- Copier ce plan dans `plans/cross-platform-hooks.md` et créer `plans/TODO.md`.
- Commits Conventional : `feat: bundle measurement script`, `refactor: port hooks to node`, `docs: …`.

## Vérification

1. `node --test plugins/garde-fous/tests/` : on alimente chaque script avec un JSON sur stdin, dans des dépôts git temporaires (dossier `$TMPDIR` dédié). Cas couverts :
   - **scanner** : clé AWS indexée, `git add . && git commit` avec fichier non suivi, `commit -am`, pragma, fichier `.md` ignoré pour l'étage clé=valeur, push sans upstream ;
   - **circuit breaker** : 3 échecs puis deny, reset sur succès, commande `Invoke-WebRequest` ;
   - **PR gate** : avec et sans `plans/impact.md` modifié ;
   - **measure-bundle** : sur un `dist` de fixture.
2. `claude plugin validate plugins/garde-fous` (si dispo) pour vérifier le schéma de `hooks.json`.
3. Test manuel macOS : la procédure du README (`/hooks`, faux secret, 4 curl httpbin).
4. Windows : pas de poste dispo ici. On fournit au README une checklist de test à faire faire par un collègue Windows (avec et sans Git Bash).
