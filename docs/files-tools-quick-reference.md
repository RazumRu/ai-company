# Files Tools Quick Reference

Quick reference guide for the new pattern-matching based file editing tools.

## 🎯 Quick Start

### Create a New File
```json
{
  "path": "/path/to/file.ts",
  "edits": [{ "oldText": "", "newText": "content here" }]
}
```

### Replace Text
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "find this text",
      "newText": "replace with this"
    }
  ],
  "dryRun": true  // Always preview first!
}
```

### Add to Beginning
```json
{
  "oldText": "current first line",
  "newText": "new first line\ncurrent first line"
}
```

### Add to End
```json
{
  "oldText": "current last line",
  "newText": "current last line\nnew last line"
}
```

### Delete File
```json
{
  "filePath": "/path/to/file.ts"
}
```

## 🔧 Available Tools

| Tool | Purpose | API |
|------|---------|-----|
| `files_apply_changes` | Create, edit, replace text | Pattern matching |
| `files_delete` | Delete files | Simple path |
| `files_read` | Read file content | Simple path |
| `files_list` | List files | Directory + pattern |
| `files_search_text` | Search content | Query + globs |

## 📝 Common Patterns

### Pattern 1: Modify Function
```json
{
  "path": "/src/utils.ts",
  "edits": [{
    "oldText": "function old() {\n  return 'old';\n}",
    "newText": "function new() {\n  return 'new';\n}"
  }]
}
```

### Pattern 2: Add Import
Read file first, then:
```json
{
  "edits": [{
    "oldText": "existing content",
    "newText": "import { x } from 'y';\n\nexisting content"
  }]
}
```

### Pattern 3: Multiple Changes
```json
{
  "path": "/src/config.ts",
  "edits": [
    { "oldText": "DEBUG = true", "newText": "DEBUG = false" },
    { "oldText": "PORT = 3000", "newText": "PORT = 8080" },
    { "oldText": "ENV = 'dev'", "newText": "ENV = 'prod'" }
  ]
}
```

### Pattern 4: Preview Then Apply
```javascript
// Step 1: Preview
{ "dryRun": true, ... }
// Check diff output

// Step 2: Apply
{ "dryRun": false, ... }
// Same edits, different dryRun flag
```

## ✅ Best Practices

1. **Always preview first**: Use `"dryRun": true`
2. **Read before editing**: Use `files_read` to see current content
3. **Be specific**: Include enough context in `oldText` to avoid multiple matches
4. **Batch related edits**: Group multiple changes in one call
5. **Check results**: Read file after editing to verify

## ⚠️ Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Found X matches" | `oldText` appears multiple times | Add more context to `oldText` |
| "Could not find match" | `oldText` doesn't exist | Read file first, verify content |
| "File not found" | Wrong path | Use `files_list` to find correct path |

## 🚀 Workflow Examples

### Safe Edit Workflow
```
1. files_read          → Get current content
2. files_apply_changes → Preview with dryRun: true
3. Review diff output
4. files_apply_changes → Apply with dryRun: false
5. files_read          → Verify changes
```

### Create and Edit Workflow
```
1. files_apply_changes → Create file (oldText: "")
2. files_apply_changes → Add content
3. files_read          → Verify
```

### Replace and Clean Workflow
```
1. files_read          → Check current state
2. files_apply_changes → Replace content
3. files_delete        → Remove if not needed
```

## 📚 More Information

- [Detailed Examples](./files-tools-examples.md) - Comprehensive usage examples
- [Migration Guide](./tool-api-migration.md) - Old API → New API migration
- [API Reference](../apps/api/src/v1/agent-tools/tools/common/files/) - Source code

## 💡 Pro Tips

### Tip 1: Whitespace Normalization
Don't worry about exact spacing - the tool normalizes it:
```json
{
  "oldText": "function   test()  {",  // Extra spaces OK
  "newText": "function test() {"
}
```

### Tip 2: Indentation Preservation
Original indentation is automatically preserved:
```json
{
  "oldText": "    nested code",
  "newText": "new code"  // Will be indented with 4 spaces automatically
}
```

### Tip 3: Empty File Handling
For new/empty files, always use `oldText: ""`:
```json
{
  "path": "/new/file.ts",
  "edits": [{ "oldText": "", "newText": "content" }]
}
```

### Tip 4: Multiple Edits Order
Edits are applied from bottom to top automatically - don't worry about order!

### Tip 5: Complex Replacements
For very complex changes, consider multiple smaller edits instead of one large edit.
