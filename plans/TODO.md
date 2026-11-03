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
- [ ] Checklist Windows du README sur un poste Windows (avec et sans Git Bash)
