## Summary

<!-- What does this PR do and why? 1-3 bullets. -->

-

## Screenshots / recordings

<!-- For UI changes, drop before/after images or a short clip. -->

## Test plan

<!-- How did you verify this? -->

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Manually exercised the affected flow

## Checklist

- [ ] Catalog rows / taste.json still validate against `@keeper/schema` (hostile-input tests updated if the schema changed)
- [ ] No secrets committed (`app/.env.local`, keys) and no large/uploaded media
- [ ] `CHANGELOG.md` updated under "Unreleased" if user-facing
- [ ] Called out if the change needs a `npm run dev` restart (main/preload/engine scripts)
