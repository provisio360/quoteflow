# Next steps (after sandbox recreate with GitHub token)

## State
- GitHub repo `provisio360/quoteflow` exists and is **empty** (no commits, default branch `main`).
- Docs are complete locally but **not yet pushed** — pushing failed because the old sandbox had no GitHub write token.

## What to publish
These files (already in this directory) seed the repo:
- `CONTEXT.md` — domain glossary
- `docs/adr/0001`–`0004` — decision records
- `docs/prd/quoteflow-v1.md` — the v1 PRD (Status: ready-for-agent)

## To push (once the sandbox has a GitHub token)
The token is provided via: `sbx secret set <sandbox-name> github -t "$(gh auth token)"` (run on the host).

Then, from this directory:
```bash
git init -b main
git add CONTEXT.md docs/
git commit -m "Add QuoteFlow v1 PRD, domain glossary, and ADRs"
git remote add origin https://github.com/provisio360/quoteflow
git push -u origin main
```

## Optional: publish PRD as a GitHub Issue (the native /to-prd path)
With API write access available, also run:
```bash
gh label create ready-for-agent -R provisio360/quoteflow --color 0e8a16 2>/dev/null || true
gh issue create -R provisio360/quoteflow \
  --title "QuoteFlow v1 PRD" \
  --body-file docs/prd/quoteflow-v1.md \
  --label ready-for-agent
```

## Open threads still to grill (not yet decided)
1. How the QC "expected range" around Client Price is defined (± percentage vs. analyst-set band).
2. Study/Quote terminal states, archival, and data retention.
3. Exact dashboard filters/cuts for views A and B.

## Optional setup
Run `/setup-matt-pocock-skills` to formalize the issue tracker (GitHub) and triage labels so `to-issues`/`triage`/`to-prd` are wired up properly.
