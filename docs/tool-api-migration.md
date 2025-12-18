# Tool API Migration: files_apply_changes

## Summary

Migrated `files_apply_changes` tool from line-number based editing to pattern matching with content-based cursor approach.

## Changes

### Old API (Line Numbers)
```json
{
  "filePath": "/path/to/file.ts",
  "operation": "replace_range",
  "startLine": 10,
  "endLine": 15,
  "content": "new content"
}
```

**Problems:**
- Line numbers are fragile - break when file changes
- Difficult for LLMs to work with
- No output of line numbers in tool responses
- Requires reading file first to get line numbers

### New API (Pattern Matching)
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "function oldName() {\n  return 'old';\n}",
      "newText": "function newName() {\n  return 'new';\n}"
    }
  ],
  "dryRun": true
}
```

**Benefits:**
- Content-based matching - more reliable
- Natural for LLMs - "replace this with that"
- Whitespace normalization with indentation preservation
- Preview mode with `dryRun: true`
- Multiple edits in one call
- No need to track line numbers

## Migration Guide

### Creating New Files

**Old:**
```json
{
  "filePath": "/path/to/file.ts",
  "operation": "replace",
  "content": "export const hello = 'world';"
}
```

**New:**
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "",
      "newText": "export const hello = 'world';"
    }
  ]
}
```

### Replacing Content

**Old:**
```json
{
  "filePath": "/path/to/file.ts",
  "operation": "replace_range",
  "startLine": 10,
  "endLine": 15,
  "content": "new implementation"
}
```

**New:**
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "function oldImplementation() {\n  // old code\n}",
      "newText": "function newImplementation() {\n  // new code\n}"
    }
  ],
  "dryRun": true  // Preview first!
}
```

### Multiple Edits

**Old:** Required multiple tool calls

**New:** Single call with multiple edits
```json
{
  "path": "/path/to/config.ts",
  "edits": [
    {
      "oldText": "const API_URL = 'localhost'",
      "newText": "const API_URL = 'production'"
    },
    {
      "oldText": "const DEBUG = true",
      "newText": "const DEBUG = false"
    }
  ]
}
```

## Adding Text Without Replacing

### To a New/Empty File
```json
{
  "path": "/path/to/new-file.ts",
  "edits": [
    {
      "oldText": "",
      "newText": "export const value = 'data';"
    }
  ]
}
```

### To the Beginning
Read file first, then prepend:
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "existing content here",
      "newText": "import { something } from './new';\n\nexisting content here"
    }
  ]
}
```

### To the End
Read file first, then append:
```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "existing content here",
      "newText": "existing content here\n\nexport function newFunc() {\n  return 'new';\n}"
    }
  ]
}
```

### In the Middle
Find unique marker and include in both:
```json
{
  "path": "/path/to/config.ts",
  "edits": [
    {
      "oldText": "export const config = {\n  api: 'localhost',\n  port: 3000,\n};",
      "newText": "export const config = {\n  api: 'localhost',\n  timeout: 5000,\n  port: 3000,\n};"
    }
  ]
}
```

## Deleting Files

Use the separate `files_delete` tool:
```json
{
  "filePath": "/path/to/file-to-delete.ts"
}
```

## Best Practices

1. **Always use dryRun first**
   ```json
   { "dryRun": true }  // Preview changes
   ```
   Review the diff output, then run again without dryRun

2. **Be specific with oldText**
   Include enough context to uniquely identify the text:
   ```json
   {
     "oldText": "async getUserById(id: string) {\n    return this.db.findOne({ id });"
   }
   ```

3. **Don't worry about exact whitespace**
   The tool normalizes whitespace for matching and preserves indentation automatically

4. **Read file first for additions**
   When adding to beginning/end/middle, use `files_read` to get current content

5. **For empty files**
   Just use `oldText: ""` - no need to read first

## Technical Details

### Pattern Matching Algorithm

1. **Whitespace Normalization**: Extra spaces/tabs normalized for matching
2. **Indentation Detection**: Automatically detects and preserves original indentation
3. **Exact Substring Match**: Case-sensitive, must be unique in file
4. **Multi-line Support**: Works with single or multiple lines

### Error Handling

- **"Could not find match"**: oldText doesn't exist, check with `files_read`
- **"Found multiple matches"**: Be more specific with oldText
- **"File not found"**: Check path with `files_list`

## Implementation Files

- Tool: `apps/api/src/v1/agent-tools/tools/common/files/files-apply-changes.tool.ts`
- Tests: `apps/api/src/v1/agent-tools/tools/common/files/files-apply-changes.tool.spec.ts`
- Integration Tests: `apps/api/src/__tests__/integration/agent-tools/files-tools.int.ts`
