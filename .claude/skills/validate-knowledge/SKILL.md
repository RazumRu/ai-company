---
name: validate-knowledge
description: "Validate the knowledge base: detect entries referencing deleted files/functions, find duplicates across knowledge files, flag generic framework knowledge that doesn't belong. Use to keep the knowledge base healthy."
model: sonnet
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash
argument-hint: "[fix|report] — 'report' for dry-run (default), 'fix' to auto-remove stale entries"
---

# Knowledge Base Validator

Validate the Geniro knowledge base in `.generated/project-knowledge/`:
- `.generated/project-knowledge/api-learnings.md`
- `.generated/project-knowledge/web-learnings.md`
- `.generated/project-knowledge/architecture-decisions.md`
- `.generated/project-knowledge/review-feedback.md`

## Mode

$ARGUMENTS

- If `fix` — automatically remove stale entries, merge duplicates, and clean up. Use the Edit tool to make changes.
- If `report` or empty — dry-run only. Report issues without modifying files.

## Validation Steps

### 1. Stale Reference Detection

Read all 4 knowledge files. For each entry that references a file path (patterns like `v1/`, `src/`, `apps/`, `packages/`):

1. Extract the file path from the entry
2. Verify the file still exists using Glob
3. If the entry references a specific function, class, or method, verify it still exists using Grep
4. Flag entries where the referenced file or function has been deleted or renamed

### 2. Duplicate Detection

Compare entries across all 4 files:

1. Find entries with substantially similar content — same pattern, gotcha, or decision described in different words or different files
2. Find entries in the wrong file — e.g., a web-specific gotcha in `api-learnings.md`, or a pattern that's really an architecture decision
3. Find entries that overlap between a learnings file and `architecture-decisions.md`

### 3. Generic Knowledge Detection

Flag entries that describe generic framework behavior rather than Geniro-specific knowledge:

**Examples of generic knowledge (should be removed):**
- "NestJS modules need to import providers" — framework basics
- "React hooks must be called at the top level" — standard React rules
- "TypeORM entities need `@Entity()` decorator" — ORM basics
- "Use `async/await` instead of callbacks" — language basics

**Examples of Geniro-specific knowledge (should be kept):**
- "`getEnv()` returns undefined at runtime despite TypeScript signature" — project-specific gotcha
- "Use `SimpleEnrichmentHandler` pattern for identical handlers" — project-specific pattern
- "Notifications inside uncommitted transactions silently fail" — project-specific behavior

The test: **would a developer familiar with the framework but new to Geniro benefit from this entry?** If yes, keep it. If any experienced developer would know this, remove it.

### 4. Frequency Audit

For entries in `review-feedback.md` with frequency counts:

1. Check if the last occurrence date is older than 60 days with frequency: 1
2. Flag these as potentially stale — they may represent one-off issues that are no longer relevant
3. Do NOT auto-remove these in "fix" mode — just flag them for manual review

### 5. Entry Quality Check

Flag entries that are:
- Missing required fields (Context, Detail, or equivalent)
- Overly vague ("be careful with X" without explaining why or how)
- Too long (more than 10 lines — entries should be concise)

## Output

```markdown
## Knowledge Base Validation Report

**Overall Health**: HEALTHY | NEEDS CLEANUP (N issues)

### Stale References (N found)
1. `api-learnings.md` line N — "[entry title]" references `v1/old-module/service.ts` which no longer exists
   - **Action**: [remove | update path to v1/new-module/service.ts]

### Duplicates (N found)
1. "[Pattern X]" appears in both `api-learnings.md` (line N) and `architecture-decisions.md` (line M)
   - **Action**: [keep in architecture-decisions.md, remove from api-learnings.md]

### Generic Knowledge (N found)
1. `web-learnings.md` line N — "[entry title]" describes standard React behavior
   - **Action**: [remove — framework documentation, not project knowledge]

### Stale Frequency Counts (N found)
1. `review-feedback.md` line N — "[Issue X]" frequency: 1, last seen 2025-11-15 (90+ days ago)
   - **Action**: [flag for manual review]

### Quality Issues (N found)
1. `api-learnings.md` line N — entry is overly vague, missing concrete prevention steps
   - **Action**: [improve or remove]

### Summary
- Total entries scanned: N
- Stale references: N
- Duplicates: N
- Generic knowledge: N
- Stale frequencies: N
- Quality issues: N
- Healthy entries: N
```

If mode is `fix`:
- Remove stale references (or update paths if the new location is obvious)
- Remove duplicates (keep the more detailed version in the correct file)
- Remove generic knowledge entries
- Improve vague entries if the correct information can be inferred, otherwise remove
- Do NOT remove stale frequency entries — only flag them
- Report all changes made
