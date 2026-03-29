---
name: learn
description: "Manage the Geniro knowledge base. View accumulated learnings, add new entries manually, search for specific knowledge, or clean up stale entries. Use after discovering something useful about the codebase, or to review what the system has learned."
model: sonnet
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash
argument-hint: "[add/view/search/cleanup/validate/stats] [details]"
---

# Knowledge Base Manager

You manage the Geniro agents' accumulated knowledge stored in project-specific directories.

## Knowledge Files

All knowledge files live in `.claude/.generated/project-knowledge/`:

- `.claude/.generated/project-knowledge/api-learnings.md` — API backend patterns, gotchas, test patterns, useful commands
- `.claude/.generated/project-knowledge/web-learnings.md` — Web frontend patterns, gotchas, component patterns, useful commands
- `.claude/.generated/project-knowledge/architecture-decisions.md` — Significant design choices with context and rationale
- `.claude/.generated/project-knowledge/review-feedback.md` — Recurring reviewer feedback patterns and quality trends

**On first use**, create the directory if it doesn't exist:
```bash
mkdir -p .claude/.generated/project-knowledge
```

## Commands

Parse `$ARGUMENTS` to determine the action:

### `view` (or no arguments)
Read and summarize all knowledge files. Present a concise overview:
- Total entries per file
- Most recent entries (last 5)
- Most impactful entries (high-frequency gotchas, critical decisions)

### `add <description>`
Interactively add a new knowledge entry:
1. Determine the best file based on the description
2. Determine the appropriate section within that file
3. Get today's date via `date +%Y-%m-%d`
4. Format the entry following the file's template
5. Append using the Edit tool

### `search <query>`
Search across all knowledge files for entries matching the query:
```bash
grep -rin -B2 -A5 "<query>" .claude/.generated/project-knowledge/ 2>/dev/null
```
Present results grouped by file. Show the full entry (from `### [` header to the next `###` or end of section) for each match.

### `cleanup`
Review all knowledge files and:
1. **Run validation first** — execute the same checks as `validate report` to identify stale, duplicate, and generic entries
2. Remove entries that are no longer accurate (check against current codebase)
3. Merge duplicate or overlapping entries
4. Update frequency counts on recurring issues
5. Archive entries older than 6 months that haven't been referenced
6. Remove generic framework knowledge that belongs in documentation, not project learnings
7. Report what was cleaned up

### `validate [fix|report]`
Run a health check on the knowledge base. Detects:
- **Stale references**: entries pointing to files or functions that no longer exist in the codebase
- **Duplicates**: substantially similar entries across different files
- **Generic knowledge**: framework basics that belong in documentation, not project learnings (e.g., "NestJS modules need to import providers")
- **Stale frequency counts**: review-feedback entries with frequency: 1 older than 60 days

**Workflow:**
1. Read all 4 knowledge files
2. For each entry with a file path reference, verify the file exists (Glob) and any referenced function/class exists (Grep)
3. Compare entries across files for duplicates or misplaced entries
4. Flag entries that describe generic framework behavior vs. Geniro-specific knowledge
5. Check frequency counts in `review-feedback.md` for staleness

**Modes:**
- `report` (default) — dry-run, show issues without modifying files
- `fix` — apply recommended removals, merges, and path updates using the Edit tool. Do NOT remove stale frequency entries — only flag them for manual review.

### `stats`
Provide analytics on the knowledge base:
- Entries per file and section
- Most common gotcha categories
- Architecture decisions timeline
- Review feedback frequency analysis
- Knowledge growth over time

## Entry Quality Rules

When adding entries:
- **NEVER save sensitive data** — no user data, production tokens, API keys, passwords, secrets, or environment-specific values. Knowledge files are committed to the repo. Only save patterns, gotchas, and technical learnings.
- Be specific and actionable — vague entries waste context
- Include file paths and concrete details
- Use today's date for timestamping
- Keep entries to 3-5 lines max
- If a similar entry exists, update it instead of duplicating
- For gotchas, always include the prevention/fix

## Format

Always use the section's comment template. Example for a gotcha:

```markdown
### [2025-01-15] Gotcha: MikroORM migration ordering
- **What happened**: Migration failed because column was referenced before creation
- **Root cause**: Two migrations generated in wrong order due to entity circular dependency
- **Fix/Workaround**: Manually reorder migration timestamps
- **Prevention**: Always check migration order after generating multiple related migrations
```
