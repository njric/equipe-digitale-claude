---
name: eco-design
description: Eco-design rules and pre-release impact review for web apps. Use when adding a dependency, an image or other heavy asset, a network call, polling or caching, and always before opening a Pull Request on a web app.
---

# Eco-design for web apps

These rules come from the organisation's ecological impact team. They apply
to every web app. When a rule cannot be followed, do not silently skip it:
record the deviation and its reason (see "Accepted deviations" below).

## 1. Rules

### Dependencies
- No new library without justification. Before proposing one, check:
  - whether a native API (browser or Node) or an existing dependency
    already covers the need;
  - its size, with `npm view <package> dist.unpackedSize` and the number
    of its own dependencies (`npm view <package> dependencies`).
- Present the need, the alternatives considered and the size to the user,
  and **ask before installing**. This complements the reputation check
  required by the Package Safety rule.
- Prefer importing only what is used (named imports, per-function packages)
  over importing a whole library.

### Images and heavy assets
- Use WebP or AVIF, sized for their actual display size (no 3000 px image
  shown at 300 px).
- Always set `width` and `height` to avoid layout shifts.
- Load images only when displayed: `loading="lazy"` on every image except
  the main above-the-fold one.
- Fonts: prefer system fonts; otherwise load only the weights and subsets
  actually used, in WOFF2.
- If the project has no image optimisation tool, list the images to
  compress for the user rather than adding a new tool without asking.

### Network calls
- No unnecessary requests: never fetch the same data twice for one view.
- No polling when an event, a webhook or a user action can trigger the update.
  If polling is unavoidable, use the longest acceptable interval and stop it
  when the page is hidden.
- Debounce calls driven by typing or scrolling.
- Batch requests when the API allows it, and request only the fields needed.

### Caching
- Static assets with hashed filenames: long-lived HTTP cache
  (`Cache-Control: public, max-age=31536000, immutable`).
- HTML and unhashed files: short cache or revalidation (ETag).
- API data that does not change at each view: cache it client-side with an
  explicit freshness duration, and invalidate it when the data is modified.

## 2. plans/impact.md — Eco-design log

Maintain `plans/impact.md` alongside `plans/TODO.md`. Create it from the
template below if it does not exist. Update it when:
- a dependency is added or removed;
- images, fonts or other heavy assets are added;
- a network call, a polling loop or a cache strategy is added or changed;
- a rule is deliberately not followed.

Template:

```markdown
# Impact log

## Bundle size
| Date | Branch | Size (gzip) | Δ vs previous |
|------|--------|-------------|---------------|

## Dependencies
| Date | Change | Package | Size | Justification |
|------|--------|---------|------|---------------|

## Assets, network calls & caching
- YYYY-MM-DD: …

## Accepted deviations
- YYYY-MM-DD: rule, reason, validated by the user (yes/no)
```

## 3. Impact review before a Pull Request

Run this review before opening any Pull Request on a web app.

1. **Measure.** Run the project's production build script (`npm run build`).
   Record the total gzip size reported by the build tool (Vite and most
   bundlers print it). If the tool does not report it, write a small script
   in a dedicated `$TMPDIR` subfolder that sums the gzip size of the build
   output, run it, then delete the subfolder by name.
2. **Compare.** Add a row to the "Bundle size" table with the difference
   from the previous entry. Flag any increase above 5 % to the user with
   its cause.
3. **Check.** Review the branch diff (`git --no-pager diff <base>...HEAD`)
   against the rules in section 1. List every deviation found.
4. **Record.** Update `plans/impact.md` (dependencies, assets, network,
   caching, deviations).
5. **Report.** Add an **Impact** section to the PR description:
   - bundle size and its variation;
   - dependencies added or removed, with their justification;
   - deviations from the rules, with their reason.

If the review finds an unjustified deviation, report it to the user before
opening the PR instead of opening it anyway.
