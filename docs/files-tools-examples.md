# Files Tools Examples

Comprehensive examples for working with `files_apply_changes` and `files_delete` tools.

## Table of Contents
- [Creating Files](#creating-files)
- [Replacing Text](#replacing-text)
- [Adding Text](#adding-text)
- [Multiple Edits](#multiple-edits)
- [Preview Mode](#preview-mode)
- [Deleting Files](#deleting-files)

## Creating Files

### Create a New File

```json
{
  "path": "/repo/src/new-file.ts",
  "edits": [
    {
      "oldText": "",
      "newText": "export const hello = 'world';\n\nexport function greet(name: string) {\n  return `Hello, ${name}!`;\n}"
    }
  ]
}
```

**Result:** Creates a new file with the specified content.

### Create an Empty File

```json
{
  "path": "/repo/src/empty.ts",
  "edits": [
    {
      "oldText": "",
      "newText": ""
    }
  ]
}
```

**Result:** Creates an empty file.

## Replacing Text

### Replace a Function

**Before:**
```typescript
export function oldName() {
  return 'old value';
}
```

**Tool Call:**
```json
{
  "path": "/repo/src/utils.ts",
  "edits": [
    {
      "oldText": "export function oldName() {\n  return 'old value';\n}",
      "newText": "export function newName() {\n  return 'new value';\n}"
    }
  ],
  "dryRun": true
}
```

**After:**
```typescript
export function newName() {
  return 'new value';
}
```

### Replace Multiple Occurrences

```json
{
  "path": "/repo/src/config.ts",
  "edits": [
    {
      "oldText": "const API_URL = 'http://localhost:3000'",
      "newText": "const API_URL = 'https://api.production.com'"
    },
    {
      "oldText": "const DEBUG = true",
      "newText": "const DEBUG = false"
    },
    {
      "oldText": "const TIMEOUT = 5000",
      "newText": "const TIMEOUT = 30000"
    }
  ]
}
```

## Adding Text

### Add Import at the Beginning

**Step 1: Read the file**
```json
{
  "filePath": "/repo/src/app.ts"
}
```
Response: `{ "content": "export const app = 'app';" }`

**Step 2: Add import**
```json
{
  "path": "/repo/src/app.ts",
  "edits": [
    {
      "oldText": "export const app = 'app';",
      "newText": "import { helper } from './helper';\n\nexport const app = 'app';"
    }
  ]
}
```

**Result:**
```typescript
import { helper } from './helper';

export const app = 'app';
```

### Add Function at the End

**Step 1: Read the file**
```json
{
  "filePath": "/repo/src/utils.ts"
}
```
Response: `{ "content": "export function helper() {\n  return true;\n}" }`

**Step 2: Append function**
```json
{
  "path": "/repo/src/utils.ts",
  "edits": [
    {
      "oldText": "export function helper() {\n  return true;\n}",
      "newText": "export function helper() {\n  return true;\n}\n\nexport function newHelper() {\n  return false;\n}"
    }
  ]
}
```

**Result:**
```typescript
export function helper() {
  return true;
}

export function newHelper() {
  return false;
}
```

### Insert Property in Object

**Before:**
```typescript
export const config = {
  api: 'http://localhost',
  port: 3000,
};
```

**Tool Call:**
```json
{
  "path": "/repo/src/config.ts",
  "edits": [
    {
      "oldText": "export const config = {\n  api: 'http://localhost',\n  port: 3000,\n};",
      "newText": "export const config = {\n  api: 'http://localhost',\n  timeout: 5000,\n  port: 3000,\n};"
    }
  ]
}
```

**After:**
```typescript
export const config = {
  api: 'http://localhost',
  timeout: 5000,
  port: 3000,
};
```

### Add Content to Empty File

**Tool Call:**
```json
{
  "path": "/repo/src/empty.ts",
  "edits": [
    {
      "oldText": "",
      "newText": "// First line of content\nexport const data = 'value';"
    }
  ]
}
```

**Result:**
```typescript
// First line of content
export const data = 'value';
```

## Multiple Edits

### Update Multiple Functions at Once

```json
{
  "path": "/repo/src/handlers.ts",
  "edits": [
    {
      "oldText": "function handleGet(req, res) {",
      "newText": "async function handleGet(req: Request, res: Response) {"
    },
    {
      "oldText": "function handlePost(req, res) {",
      "newText": "async function handlePost(req: Request, res: Response) {"
    },
    {
      "oldText": "function handleDelete(req, res) {",
      "newText": "async function handleDelete(req: Request, res: Response) {"
    }
  ],
  "dryRun": true
}
```

## Preview Mode

### Use dryRun to Preview Changes

**Step 1: Preview**
```json
{
  "path": "/repo/src/important.ts",
  "edits": [
    {
      "oldText": "const criticalValue = 100;",
      "newText": "const criticalValue = 200;"
    }
  ],
  "dryRun": true
}
```

**Response:**
```json
{
  "success": true,
  "appliedEdits": 0,
  "totalEdits": 1,
  "diff": "@@ -5,1 +5,1 @@\n-const criticalValue = 100;\n+const criticalValue = 200;"
}
```

**Step 2: Review diff, then apply**
```json
{
  "path": "/repo/src/important.ts",
  "edits": [
    {
      "oldText": "const criticalValue = 100;",
      "newText": "const criticalValue = 200;"
    }
  ],
  "dryRun": false
}
```

**Response:**
```json
{
  "success": true,
  "appliedEdits": 1,
  "totalEdits": 1
}
```

## Deleting Files

### Delete a Single File

```json
{
  "filePath": "/repo/src/temp-file.ts"
}
```

**Response:**
```json
{
  "success": true
}
```

### Common Delete Scenarios

**Delete test file:**
```json
{
  "filePath": "/repo/src/__tests__/obsolete.spec.ts"
}
```

**Delete generated file:**
```json
{
  "filePath": "/repo/dist/temp-output.js"
}
```

**Note:** `files_delete` only works with files, not directories. Use shell commands for directory operations.

## Error Handling

### Handle "Multiple Matches" Error

**Error:**
```json
{
  "success": false,
  "error": "Edit 0: Found 3 matches for oldText. Please be more specific to match uniquely."
}
```

**Solution:** Add more context to oldText:
```json
{
  "oldText": "// Include more surrounding context\nexport function helper() {\n  return true;\n}\n// Even some context after",
  "newText": "// Include more surrounding context\nexport function newHelper() {\n  return false;\n}\n// Even some context after"
}
```

### Handle "Could Not Find Match" Error

**Error:**
```json
{
  "success": false,
  "error": "Edit 0: Could not find match for oldText in file."
}
```

**Solution:** Read the file first to verify content:
1. Use `files_read` to see actual content
2. Copy exact text including whitespace
3. Or let whitespace normalization handle minor differences

## Tips and Tricks

### Preserve Indentation Automatically

The tool automatically detects and preserves indentation:

```json
{
  "oldText": "  function nested() {\n    return true;\n  }",
  "newText": "function nested() {\n  return false;\n}"
}
```

Result maintains the 2-space indentation of the original.

### Work with Different Line Endings

The tool handles different line endings automatically. Use `\n` in your JSON.

### Batch Related Changes

Group related changes in a single call for atomicity:

```json
{
  "path": "/repo/src/refactor.ts",
  "edits": [
    {
      "oldText": "class OldName {",
      "newText": "class NewName {"
    },
    {
      "oldText": "new OldName()",
      "newText": "new NewName()"
    },
    {
      "oldText": "import { OldName }",
      "newText": "import { NewName }"
    }
  ]
}
```
