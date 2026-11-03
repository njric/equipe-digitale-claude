# TODO

Plan détaillé : [cross-platform-hooks.md](cross-platform-hooks.md)

- [x] Script de mesure `skills/eco-design/scripts/measure-bundle.mjs` + mise à jour SKILL.md
- [x] Librairies partagées `scripts/lib/hook-io.mjs`, `scripts/lib/endpoint.mjs`
- [x] Portage Node : check-deps, eco-design-reminder, eco-design-pr-gate
- [x] Portage Node : circuit-breaker-block, circuit-breaker-eval
- [x] Portage Node : secret-scanner
- [x] `hooks.json` en forme exec, matcher `Bash|PowerShell` ; suppression des `.sh`
- [x] Tests `node --test` (33/33 sur macOS, dont les corrections de la revue de code)
- [x] README, version 1.3.0
- [x] Test manuel macOS via `--plugin-dir` : hooks `.mjs` chargés, secret sur une ligne `+AKIA…` bloqué au commit (cas que l'ancienne version ne voyait pas)
- [x] Test de bout en bout macOS (prompt dans un dépôt vierge) : tout au vert
- [ ] Test Windows par un collègue (prompts de préparation et de test, via l'app desktop)

## 1.3.1 : détection éco-conception

- [x] Rappel au démarrage dans toutes les sessions (formulé au conditionnel hors projet web)
- [x] Projet web = `package.json` à la racine ou dans un dossier de premier niveau (`lib/web-project.mjs`)
- [x] Tests (36/36)

## Plus tard : skill CI/CD

- [ ] Intégrer une étape éco-conception au workflow type (build, mesure, échec si `plans/impact.md` non modifié ou bundle +5 %), seule vraie garantie face aux PR ouvertes hors Claude
- [ ] Réutiliser `measure-bundle.mjs` en CI sans en créer une copie divergente (copie versionnée ou action partagée)
- [ ] Décider : même plugin `garde-fous` ou plugin séparé dans la marketplace
