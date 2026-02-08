# Tool Definitions: Best Practices

Guidelines for writing effective tool `description` fields and parameter `.describe()` strings in our agent tool system.

**All current and new tools MUST follow the official Anthropic best practices:**
[https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions)

Key official requirements:
- **Provide extremely detailed descriptions** — at least 3-4 sentences per tool. Explain what the tool does, when it should be used (and when it shouldn't), what each parameter means and how it affects behavior, and any important caveats or limitations.
- **Every parameter needs a clear description** — what it means, its format/valid values, and how it affects the tool's behavior.
- **Good descriptions prevent misuse** — the more context the model has, the better it selects and invokes tools. Short/vague descriptions lead to wrong tool selection and invalid inputs.

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
| "Stored in Qdrant" | "Semantic search" |
| "Via gh CLI" | "Using authenticated HTTPS" |
| "Vector similarity search" | "Semantic search" |
| "An LLM interprets the sketch" | "The sketch is interpreted to produce edits" |

### No Redundant Restating

Do not repeat the tool name in the description. The model already has the name.

---

## `getDetailedInstructions()` vs. `description`

Our tool system has two levels of documentation:

| Field | Where it appears | Purpose |
|---|---|---|
| `description` | In the JSON schema sent with every tool call | **Concise tool selection** — the model reads ALL descriptions to pick the right tool |
| `getDetailedInstructions()` | Injected into the system prompt | **Comprehensive guidance** — workflows, examples, edge cases, error handling |

### Key Rule: Heavy Details Belong in `getDetailedInstructions()`

The `description` field is included in every API call. It should be **short and focused on tool selection** — just enough for the model to know when to use this tool vs. another. All heavy information (matching strategies, retry workflows, code examples, error recovery, permission rules, etc.) belongs in `getDetailedInstructions()`.

### `description` Guidelines (2-4 concise sentences)

- **What** the tool does and what it returns
- **When** to use it (primary use case, one line)
- **When NOT** to use it or which alternative to prefer
- NO implementation details, NO workflow steps, NO examples, NO limits

### `getDetailedInstructions()` Guidelines (comprehensive)

Structure with markdown headers:

```
### Overview
Brief summary (1-2 sentences)

### When to Use
- Bulleted list of specific use cases

### When NOT to Use
- Common mis-selections with the correct alternative tool

### Best Practices / How to Use
- Step-by-step workflow with context
- Matching strategies, retry logic, permission rules, etc.

### Examples
Concrete JSON examples for common scenarios

### Common Errors / Troubleshooting
- Error messages and their resolutions
```

### Examples of the Split

**Description (concise — for tool selection):**
```ts
public description =
  'Replace exact text blocks in a file or insert new text at a specific line. '
  + 'Supports progressive matching with whitespace tolerance. '
  + 'Set replaceAll=true to replace every occurrence.';
```

**getDetailedInstructions (comprehensive — for usage guidance):**
```ts
### Matching Strategy (Progressive Fallback)
Three strategies tried in order:
1. **Exact**: whitespace-normalized comparison
2. **Trimmed**: ignores leading whitespace per line
3. **Fuzzy**: Levenshtein distance ≤ 15%

### Stale-Read Protection
Pass `expectedHash` from `files_read` to detect changes...

### Examples
**1. Simple replacement:**
{"filePath": "...", "oldText": "...", "newText": "..."}
```

---

## Cross-Tool Disambiguation

When multiple tools have overlapping capabilities, explicitly state which tool to prefer:

```ts
// In files_apply_changes description:
'...Supports multiple edits in one call via the edits array for atomic multi-region changes.'

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
