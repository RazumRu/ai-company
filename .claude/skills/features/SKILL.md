---
name: features
description: "Manage the feature backlog. List all features with status, show next pending feature, mark features as complete, or update status. Features are stored in .claude/.generated/project-features/."
model: haiku
allowed-tools:
  - Read
  - Edit
  - Glob
  - Grep
  - Bash
argument-hint: "[list|next|complete <name>|status <name> <new-status>]"
---

# Feature Backlog Manager

Manage the Geniro feature backlog stored in `.claude/.generated/project-features/`.

## Command

$ARGUMENTS

Parse the arguments to determine the action:

### `list` (or no arguments)

List all features with their status, size, and creation date.

```bash
# Check if directory exists
ls .claude/.generated/project-features/*.md 2>/dev/null
```

For each `.md` file found (excluding the `completed/` subdirectory), read the YAML frontmatter and extract:
- `name`
- `status` (draft, approved, in-progress, completed)
- `size` (S, M, L)
- `type` (feature, bugfix, refactor, task)
- `created`
- `updated`

**Auto-archive misplaced completed features:** If any feature in the main directory has `status: completed`, it should have been moved but wasn't. Automatically fix this:
1. Update `updated` to today's date if not already set
2. Move the file:
   ```bash
   mkdir -p .claude/.generated/project-features/completed
   mv .claude/.generated/project-features/<name>.md .claude/.generated/project-features/completed/<name>.md
   ```
3. Report: `Auto-archived <name> to completed/ (status was already 'completed')`

Also check `.claude/.generated/project-features/completed/` for recently completed features.

**Present as a formatted table:**

```
## Feature Backlog

| # | Name | Status | Size | Type | Created | Updated |
|---|------|--------|------|------|---------|---------|
| 1 | feature-name | approved | M | feature | 2026-02-24 | 2026-02-24 |
| 2 | another-task | in-progress | S | task | 2026-02-23 | 2026-02-24 |

## Recently Completed

| Name | Size | Type | Completed |
|------|------|------|-----------|
| old-feature | L | feature | 2026-02-20 |

To implement the next approved feature:
  /implement feature: <name>

To mark a feature as done:
  /features complete <name>

To create a new feature:
  /spec <description>
```

If no features exist, show:
```
No features in the backlog yet.

Create one with: /spec <description>
```

### `next`

Find the next feature ready for implementation:

1. Read all `.md` files in `.claude/.generated/project-features/` (not `completed/`)
2. Filter for `status: approved` (ready to implement)
3. Sort by creation date (oldest first)
4. Show the first match with its full spec

If no approved features exist, check for `draft` features and suggest the user approve one.

```
## Next Feature Ready for Implementation

**<feature-name>** (Size: M, Created: 2026-02-24)

<show the Problem Statement and Requirements sections>

To implement:
  /implement feature: <feature-name>
```

### `complete <name>`

Move a feature to the completed folder:

1. Find `.claude/.generated/project-features/<name>.md`
2. Update the YAML frontmatter:
   - Set `status: completed`
   - Set `updated: <today's date>`
3. Move the file to `.claude/.generated/project-features/completed/<name>.md`:
   ```bash
   mkdir -p .claude/.generated/project-features/completed
   mv .claude/.generated/project-features/<name>.md .claude/.generated/project-features/completed/<name>.md
   ```
4. Confirm:
   ```
   ✅ Feature "<name>" marked as completed and moved to .claude/.generated/project-features/completed/
   ```

### `status <name> <new-status>`

Update a feature's status without moving it:

1. Find `.claude/.generated/project-features/<name>.md`
2. Valid statuses: `draft`, `approved`, `in-progress`, `completed`
3. Update the `status` and `updated` fields in the YAML frontmatter using the Edit tool
4. If new status is `completed`, also move to `completed/` subdirectory (same as `complete` command)
5. Confirm the change

### `show <name>`

Show the full spec for a specific feature:

1. Find `.claude/.generated/project-features/<name>.md` (check both active and completed dirs)
2. Read and display the full content
3. Show implementation instructions if status is `approved`

## Rules

- **Always check if the directory exists** before trying to read files. If `.claude/.generated/project-features/` doesn't exist, tell the user to create a feature first with `/spec`.
- **Fuzzy name matching** — if the user types a partial name, try to match it (e.g., `thread` matches `thread-auto-naming.md`).
- **Be concise** — this is a management tool, not an analyzer. Show formatted output quickly.
