# Workflow: ImpactGraph + Cursor

Same loop as [claude-code.md](claude-code.md) — specification → analysis → approval → export →
implement → review — with Cursor as the implementing agent. Read that document first; only the
hand-off step differs.

## Hand-off to Cursor

Generate the context, then bring it into Cursor's chat/composer:

```bash
impactgraph analyze feature.md --format json     # → analysis id
impactgraph approve <analysisId>
impactgraph export --format markdown > implementation-context.md
```

Options, in order of preference:

1. **Reference the file** — keep `implementation-context.md` in the workspace and tell Cursor:
   `Implement the feature per @implementation-context.md. Stay within the required/likely
impact list; honor the architecture constraints and test expectations.`
2. **Paste the context** — `impactgraph export --format markdown | pbcopy` (macOS) and paste it
   into the conversation. The §38.1 report is self-contained.
3. **Rules file** — for long sessions, paste the "Architecture Constraints" and
   "Required Impacts" sections into `.cursor/rules/` so every request carries them.

Privacy note (§9.4): the export is a local document. Whether and where Cursor transmits it is
controlled by Cursor's settings — ImpactGraph transmits nothing itself.

## Review

```bash
impactgraph review working-tree --format markdown
```

Exit code 3 means discrepancies were found (missing required impacts, unexpected components,
divergent changes, or §27 rule violations) — inputs to your judgment, not an automatic failure.
Re-prompt Cursor with the review report to close the gaps:

```bash
impactgraph review working-tree --format markdown > review-report.md
# "Address the Missing and Divergent findings in @review-report.md"
```
