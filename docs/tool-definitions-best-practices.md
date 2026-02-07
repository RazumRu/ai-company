# Tool Definitions: Best Practices

Guidelines for writing effective tool `description` fields and parameter `.describe()` strings in our agent tool system.

Based on [Claude's official tool use best practices](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions).

---

## Core Principle

> The tool `description` is **by far the most important factor** in tool performance.

The model reads every tool's `description` and parameter descriptions at each turn to decide which tool to call and how to call it. Investing in clear, thorough descriptions directly improves tool selection accuracy and reduces invalid invocations.

---

## Tool `description` Field

### Minimum Requirements

Every tool description must cover **all four** of these areas in at least 3-4 sentences:

| Area | What to include |
|---|---|
| **What the tool does** | Core action, return format, side effects |
| **When to use it** | Primary use cases, recommended workflow position |
| **When NOT to use it** | Common mis-selections, better alternatives for related tasks |
| **Caveats / limitations** | Size limits, default behavior, destructive operations, prerequisites |

### Good vs. Bad Examples

**Bad** (too short, vague):
```ts
public description = 'Search file contents using regex.';
```

**Good** (detailed, actionable):
```ts
public description =
  'Search file contents using a regex pattern and return matching file paths, '
  + 'line numbers, and matched text. Returns up to 15 matches. Best used after '
  + 'codebase_search for exact pattern matching (function names, variable references, '
  + 'import paths). Supports include/exclude glob filters via onlyInFilesMatching '
  + 'and skipFilesMatching. Common build/cache directories (node_modules, dist, .next, '
  + 'etc.) are excluded by default.';
```

### Description Checklist

- [ ] States what the tool returns (format, structure)
- [ ] Mentions prerequisites (e.g., "file must be read first", "repository must be cloned")
- [ ] References related tools for disambiguation (e.g., "use X instead for Y")
- [ ] Notes default behavior for optional parameters
- [ ] Mentions limits (max results, max file size, truncation)
- [ ] Warns about destructive actions if applicable

---

## Parameter `.describe()` Strings

### Requirements

Each parameter description should include:

1. **What the parameter controls** — its purpose in one clear sentence
2. **Format / valid values** — expected type, patterns, examples
3. **Default behavior** — what happens when omitted (for optional params)
4. **Effect on tool behavior** — how different values change the output

### Good vs. Bad Examples

**Bad:**
```ts
query: z.string().describe('Search query')
```

**Good:**
```ts
query: z.string().describe(
  'A natural-language phrase or question describing what you are looking for '
  + '(e.g., "where is the authentication middleware defined?"). Do not use single '
  + 'keywords — multi-word semantic queries produce much better results.'
)
```

**Bad:**
```ts
depth: z.number().optional().describe('Clone depth')
```

**Good:**
```ts
depth: z.number().optional().describe(
  'Shallow clone depth — only fetch the last N commits. Use depth=1 for large '
  + 'repos when full history is not needed. Omit for a full clone with complete history.'
)
```

---

## What NOT to Include

### No Implementation Details

Do not mention internal implementation libraries, frameworks, or infrastructure in descriptions. The model does not need to know what runs behind the tool.

| Avoid | Use instead |
|---|---|
| "Search using ripgrep" | "Search file contents using regex" |
| "Powered by Tavily API" | "Search the web" |
| "Stored in Qdrant" | "Using vector embeddings" |
| "Via gh CLI" | "Using authenticated HTTPS" |

### No Redundant Restating

Do not repeat the tool name in the description. The model already has the name.

---

## `getDetailedInstructions()` vs. `description`

Our tool system has two levels of documentation:

| Field | Where it appears | Purpose |
|---|---|---|
| `description` | In the JSON schema sent with every tool call | Quick disambiguation — the model reads all descriptions to pick the right tool |
| `getDetailedInstructions()` | Injected into the system prompt | Deep guidance — workflows, examples, edge cases, error handling |

### Guidelines

- **`description`**: Keep it to 3-6 sentences. Focus on *what*, *when*, *returns*, and *caveats*. Must stand alone without `getDetailedInstructions`.
- **`getDetailedInstructions()`**: Can be much longer. Include step-by-step workflows, JSON examples, prerequisite chains, error troubleshooting, and best practices.

---

## Cross-Tool Disambiguation

When multiple tools have overlapping capabilities, explicitly state which tool to prefer:

```ts
// In files_apply_changes description:
'...For sketch-based edits, use files_edit instead.'

// In files_edit description:
'...For precise single-block replacements, use files_apply_changes instead.'

// In codebase_search description:
'...For exact string/regex matching, follow up with files_search_text.'
```

This prevents the model from picking the wrong tool for a given task.

---

## Template

Use this template when writing a new tool description:

```ts
public description =
  '<One sentence: what the tool does and what it returns.> '
  + '<One sentence: primary use case and when to reach for this tool.> '
  + '<One sentence: when NOT to use it or which alternative tool to prefer.> '
  + '<One sentence: key defaults, limits, prerequisites, or caveats.>';
```

And for parameters:

```ts
paramName: z
  .string()
  .describe(
    '<What this parameter controls.> '
    + '<Format/valid values, with an inline example if helpful.> '
    + '<Default behavior when omitted (for optional params).>'
  )
```
