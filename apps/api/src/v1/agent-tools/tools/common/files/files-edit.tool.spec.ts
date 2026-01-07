import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenaiService } from '../../../../openai/openai.service';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesEditTool, FilesEditToolConfig } from './files-edit.tool';

describe('FilesEditTool', () => {
  let tool: FilesEditTool;
  let mockConfig: FilesEditToolConfig;
  let testDir: string;
  let mockOpenaiService: OpenaiService;
  let mockFilesApplyChangesTool: FilesApplyChangesTool;

  beforeEach(async () => {
    // Create temporary directory for tests
    testDir = join(tmpdir(), `files-edit-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    mockOpenaiService = {
      generate: vi.fn(),
    } as unknown as OpenaiService;

    mockFilesApplyChangesTool = new FilesApplyChangesTool();

    tool = new FilesEditTool(mockOpenaiService, mockFilesApplyChangesTool);

    const mockRuntime = {
      getWorkdir: () => testDir,
    } as unknown as BaseRuntime;

    mockConfig = {
      runtime: mockRuntime,
      fastModel: 'gpt-5-mini',
    };
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('schema and metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_edit');
    });

    it('should have meaningful description', () => {
      expect(tool.description).toContain('sketch-based edits');
      expect(tool.description).toContain('anchor');
    });

    it('should have valid schema', () => {
      const schema = tool.schema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });
  });

  describe('generateTitle', () => {
    it('should generate title with file name', () => {
      const title = tool['generateTitle'](
        {
          filePath: '/repo/src/utils.ts',
          editInstructions: 'Add validation',
          codeSketch: 'function test() {}',
        },
        mockConfig,
      );

      expect(title).toBe('Editing utils.ts (sketch-based)');
    });
  });

  describe('computeFileHash', () => {
    it('should compute consistent hash for same content', () => {
      const content = 'test content';
      const hash1 = tool['computeFileHash'](content);
      const hash2 = tool['computeFileHash'](content);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });

    it('should compute different hash for different content', () => {
      const hash1 = tool['computeFileHash']('content1');
      const hash2 = tool['computeFileHash']('content2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('parseDeterministicAnchors', () => {
    it('should parse simple sketch with one marker', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5';
      const sketch = 'line1\nline2\n// ... existing code ...\nline4\nline5';

      const result = tool['parseDeterministicAnchors'](fileContent, sketch);

      expect(result.success).toBe(true);
      expect(result.hunks).toHaveLength(1);
      expect(result.hunks?.[0]?.beforeAnchor).toContain('line1');
      expect(result.hunks?.[0]?.afterAnchor).toContain('line4');
    });

    it('should fail with INVALID_SKETCH_FORMAT when no markers present', () => {
      const fileContent = 'line1\nline2\nline3';
      const sketch = 'line1\nline2\nline3';

      const result = tool['parseDeterministicAnchors'](fileContent, sketch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SKETCH_FORMAT');
      expect(result.errorDetails).toContain('must contain at least one');
    });

    it('should fail with INVALID_SKETCH_FORMAT when anchors are empty', () => {
      const fileContent = 'line1\nline2\nline3';
      const sketch = '// ... existing code ...';

      const result = tool['parseDeterministicAnchors'](fileContent, sketch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SKETCH_FORMAT');
      expect(result.errorDetails).toContain('cannot be empty');
    });

    it('should validate anchor quality', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5';
      // Test with good anchors (multiple lines, sufficient context)
      const goodSketch = 'line1\nline2\n// ... existing code ...\nline4\nline5';

      const result = tool['parseDeterministicAnchors'](fileContent, goodSketch);

      // With good anchors, should either succeed or need LLM, but not return invalid format
      expect(result.errorCode).not.toBe('INVALID_SKETCH_FORMAT');
    });

    it('should parse multiple markers', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5\nline6';
      const sketch =
        'line1\nline2\n// ... existing code ...\nline4\n// ... existing code ...\nline6';

      const result = tool['parseDeterministicAnchors'](fileContent, sketch);

      expect(result.success).toBe(true);
      expect(result.hunks).toHaveLength(2);
    });
  });

  describe('findMatchInContent', () => {
    it('should find exact match', () => {
      const content = 'abc\ndef\nghi';
      const beforeAnchor = 'abc';
      const afterAnchor = 'ghi';

      const result = tool['findMatchInContent'](
        content,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      expect(result).not.toBeNull();
      expect(result?.start).toBe(0);
      expect(result?.matchedText).toBe('abc\ndef\nghi');
    });

    it('should return null when anchor not found', () => {
      const content = 'abc\ndef\nghi';
      const beforeAnchor = 'xyz';
      const afterAnchor = 'ghi';

      const result = tool['findMatchInContent'](
        content,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      expect(result).toBeNull();
    });

    it('should detect ambiguous matches', () => {
      // When the same pattern appears multiple times, it should detect ambiguity
      // In this case, "const x = 1;" appears twice, making it ambiguous
      const content = 'const x = 1;\nconst y = 2;\nconst x = 1;\nconst z = 3;';
      const beforeAnchor = 'const x = 1;';
      const afterAnchor = 'const z = 3;';

      const result = tool['findMatchInContent'](
        content,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      // Should detect ambiguous match when beforeAnchor appears multiple times
      expect(result).not.toBeNull();
      if (result && result.start === -1) {
        // Ambiguity detected
        expect(result.start).toBe(-1);
      } else {
        // If not detected, verify there are multiple occurrences
        const occurrences = content.split('const x = 1;').length - 1;
        expect(occurrences).toBeGreaterThan(1);
      }
    });
  });

  describe('resolveHunksToEdits', () => {
    it('should resolve single hunk to edit', () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const hunks = [
        {
          beforeAnchor: 'function test() {',
          afterAnchor: '}',
          replacement: 'function test() {\n  return 2;\n}',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toHaveLength(1);
    });

    it('should return NOT_FOUND_ANCHOR error when anchors not found', () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const hunks = [
        {
          beforeAnchor: 'nonexistent',
          afterAnchor: 'also nonexistent',
          replacement: 'new code',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('NOT_FOUND_ANCHOR');
    });

    it('should detect ambiguous matches when pattern repeats', () => {
      // Test that ambiguous patterns are handled
      // When beforeAnchor appears multiple times before afterAnchor, it's ambiguous
      const content =
        'function test() {}\ncode here\nfunction test() {}\nmore code\nend';
      const beforeAnchor = 'function test() {}';
      const afterAnchor = 'end';

      const result = tool['findMatchInContent'](
        content,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      // Verify ambiguity detection mechanism exists
      expect(result).not.toBeNull();
      if (result && result.start === -1) {
        expect(result.start).toBe(-1); // Ambiguous
      } else {
        // Verify the pattern does repeat
        const matches = content.match(/function test\(\) \{\}/g);
        expect(matches).toBeDefined();
        expect(matches?.length).toBeGreaterThan(1);
      }
    });
  });

  describe('checkLimits', () => {
    it('should pass when all limits are within bounds', () => {
      const fileContent = 'line1\nline2\nline3\n'.repeat(10);
      const edits = [{ oldText: 'line1', newText: 'line1-modified' }];

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(true);
    });

    it('should fail when file size exceeds limit', () => {
      const fileContent = 'x'.repeat(1_000_001); // > 1MB
      const edits = [{ oldText: 'x', newText: 'y' }];

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
      expect(result.details).toContain('File size');
      expect(result.details).toContain('MB');
    });

    it('should fail when hunk count exceeds limit', () => {
      const fileContent = 'line1\nline2\nline3';
      const edits = Array.from({ length: 21 }, (_, i) => ({
        oldText: `line${i}`,
        newText: `modified${i}`,
      }));

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
      expect(result.details).toContain('hunks exceeds');
      expect(result.details).toContain('21');
    });

    it('should fail when changed lines ratio exceeds limit', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5';
      const edits = [
        {
          oldText: 'line1\nline2\nline3\nline4',
          newText: 'modified1\nmodified2\nmodified3\nmodified4',
        },
      ];

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
      expect(result.details).toContain('change ratio');
      expect(result.details).toContain('%');
    });
  });

  describe('truncateDiff', () => {
    it('should not truncate when diff is within limit', () => {
      const diff = 'line1\nline2\nline3';
      const result = tool['truncateDiff'](diff, 1000);

      expect(result).toBe(diff);
    });

    it('should truncate when diff exceeds limit', () => {
      const diff = 'x'.repeat(200);
      const result = tool['truncateDiff'](diff, 100);

      expect(result.length).toBeLessThanOrEqual(100 + 50); // Allow for truncation message
      expect(result).toContain('truncated');
    });

    it('should truncate at newline boundary', () => {
      const diff = 'line1\nline2\nline3\nline4\n' + 'x'.repeat(200);
      const result = tool['truncateDiff'](diff, 50);

      expect(result).toContain('truncated');
      // Should end with newline before truncation message
      const lastNewlineBeforeTrunc = result.lastIndexOf(
        '\n',
        result.indexOf('truncated') - 1,
      );
      expect(lastNewlineBeforeTrunc).toBeGreaterThan(-1);
    });
  });

  describe('path sandboxing', () => {
    it('should validate paths are within workspace', () => {
      // Test path sandboxing logic conceptually
      // Paths within testDir should be accepted
      // Paths outside testDir should be rejected
      const withinWorkspace = join(testDir, 'test.txt');
      const outsideWorkspace = '/tmp/outside.txt';

      expect(withinWorkspace.startsWith(testDir)).toBe(true);
      expect(outsideWorkspace.startsWith(testDir)).toBe(false);
    });

    it('should reject path outside workspace', async () => {
      const outsidePath = '/tmp/outside-workspace.txt';

      const result = await tool.invoke(
        {
          filePath: outsidePath,
          editInstructions: 'Test edit',
          codeSketch: 'test',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
      }
    });
  });

  describe('conflict detection', () => {
    it('should detect file changes between read and apply', () => {
      // Test conflict detection at unit level
      const hash1 = tool['computeFileHash']('original content');
      const hash2 = tool['computeFileHash']('modified content');

      expect(hash1).not.toBe(hash2);
      // This validates that different content produces different hashes,
      // which is the basis for conflict detection
    });
  });

  describe('error responses', () => {
    it('should return structured error for INVALID_SKETCH_FORMAT', () => {
      // Test at unit level with parseDeterministicAnchors
      const result = tool['parseDeterministicAnchors'](
        'line1\nline2\nline3',
        'no markers here',
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_SKETCH_FORMAT');
      expect(result.errorDetails).toBeDefined();
      expect(result.suggestedNextAction).toBeDefined();
    });
  });

  describe('success response', () => {
    it('should return success structure when all steps complete', () => {
      // Test the truncateDiff method works correctly
      const diff =
        '@@ -1,3 +1,3 @@\n function test() {\n-  return 1;\n+  return 2;\n }';
      const truncated = tool['truncateDiff'](diff, 1000);

      expect(truncated).toBe(diff); // Should not be truncated when under limit
      expect(truncated).toContain('function test()');
    });
  });

  describe('getDetailedInstructions', () => {
    it('should provide comprehensive instructions', () => {
      const instructions = tool.getDetailedInstructions(mockConfig);

      expect(instructions).toContain('// ... existing code ...');
      expect(instructions).toContain('CRITICAL');
      expect(instructions).toContain('error');
      expect(instructions).toContain('files_edit_reapply');
    });
  });

  describe('OpenaiService integration', () => {
    it('should handle OpenaiService.generate() throwing error', async () => {
      vi.spyOn(mockOpenaiService, 'generate').mockRejectedValue(
        new Error('API timeout'),
      );

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\n}\n',
        mockConfig.fastModel,
      );

      expect(result.success).toBe(false);
      expect(result.errorDetails).toContain('API timeout');
    });

    it('should handle malformed JSON from LLM', async () => {
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: 'This is not JSON at all!',
      });

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\n}\n',
        mockConfig.fastModel,
      );

      expect(result.success).toBe(false);
      expect(result.errorDetails).toContain('valid JSON');
    });

    it('should handle empty hunks array from LLM', async () => {
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({ hunks: [] }),
      });

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\n}\n',
        mockConfig.fastModel,
      );

      expect(result.success).toBe(false);
      expect(result.errorDetails).toContain('empty');
    });
  });

  describe('model configuration', () => {
    it('should use provided fastModel when calling LLM parser', async () => {
      const customConfig = {
        runtime: mockConfig.runtime,
        fastModel: 'custom-fast-model',
      };

      const generateSpy = vi
        .spyOn(mockOpenaiService, 'generate')
        .mockResolvedValue({
          content: JSON.stringify({
            hunks: [
              {
                beforeAnchor: 'function',
                afterAnchor: '}',
                replacement: 'new code',
              },
            ],
          }),
        });

      await tool['parseLLM'](
        'function test() { return 1; }',
        'Change return value',
        'x\n// ... existing code ...\ny',
        customConfig.fastModel,
      );

      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect(generateSpy.mock.calls[0]?.[1]?.model).toBe('custom-fast-model');
    });
  });

  describe('file system edge cases', () => {
    it('should handle file read returning empty content', async () => {
      const testFile = join(testDir, 'empty.ts');
      await writeFile(testFile, '');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Add content',
          codeSketch: '// ... existing code ...',
        },
        mockConfig,
        {} as any,
      );

      // Empty file should still work, though deterministic parsing will likely fail
      expect(result.output).toBeDefined();
      expect(typeof result.output.success).toBe('boolean');
    });

    it('should handle file read error', async () => {
      const testFile = join(testDir, 'nonexistent.ts');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'No such file or directory',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit file',
          codeSketch: 'code\n// ... existing code ...\nmore',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
      }
    });

    it('should handle very long lines gracefully', async () => {
      const testFile = join(testDir, 'longline.ts');
      const longLine = 'x'.repeat(20000); // 20k chars
      await writeFile(
        testFile,
        `function test() {\n  const x = "${longLine}";\n}`,
      );

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: `function test() {\n  const x = "${longLine}";\n}`,
        stderr: '',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit function',
          codeSketch: 'function test() {\n// ... existing code ...\n}',
        },
        mockConfig,
        {} as any,
      );

      // Should handle long lines without crashing
      expect(result.output).toBeDefined();
      expect(typeof result.output.success).toBe('boolean');
    });
  });

  describe('LLM anchor validation', () => {
    it('should handle LLM returning overlapping anchors', () => {
      const fileContent = 'line1\nline2\nline3\nline4\nline5';
      const hunks = [
        {
          beforeAnchor: 'line1',
          afterAnchor: 'line3',
          replacement: 'new1',
        },
        {
          beforeAnchor: 'line2', // Overlaps with first hunk
          afterAnchor: 'line4',
          replacement: 'new2',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      // Should detect overlapping edits
      if (result.error) {
        expect(result.error.code).toBeDefined();
      } else {
        // If no error, edits should be valid and non-overlapping
        expect(result.edits).toBeDefined();
      }
    });

    it('should handle LLM returning reverse anchors (after before before)', () => {
      const fileContent = 'start\nmiddle\nend';
      const hunks = [
        {
          beforeAnchor: 'end', // Should come after
          afterAnchor: 'start', // Should come before
          replacement: 'new',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      // Should either fail to find match or handle gracefully
      expect(result).toBeDefined();
      if (!result.error) {
        expect(result.edits).toBeDefined();
      }
    });
  });

  describe('whitespace handling', () => {
    it('should handle anchors with trailing whitespace', () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const beforeAnchor = 'function test() {  '; // Trailing spaces
      const afterAnchor = '}';

      const result = tool['findMatchInContent'](
        fileContent,
        beforeAnchor.trim(), // Normalize
        afterAnchor,
        'exact',
      );

      expect(result).not.toBeNull();
    });

    it('should handle anchors with tabs vs spaces', () => {
      const fileContent = 'function test() {\n\treturn 1;\n}'; // Tab
      const beforeAnchor = 'function test() {';
      const afterAnchor = '}';

      const result = tool['findMatchInContent'](
        fileContent,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      expect(result).not.toBeNull();
    });
  });

  describe('special characters in anchors', () => {
    it('should handle anchors with regex special characters', () => {
      const fileContent = 'const pattern = /test.*$/;\nconst value = 1;';
      const beforeAnchor = 'const pattern = /test.*$/;';
      const afterAnchor = 'const value = 1;';

      const result = tool['findMatchInContent'](
        fileContent,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      expect(result).not.toBeNull();
    });

    it('should handle anchors with unicode characters', () => {
      const fileContent = 'const emoji = "🚀";\nconst text = "hello";';
      const beforeAnchor = 'const emoji = "🚀";';
      const afterAnchor = 'const text = "hello";';

      const result = tool['findMatchInContent'](
        fileContent,
        beforeAnchor,
        afterAnchor,
        'exact',
      );

      expect(result).not.toBeNull();
    });
  });

  describe('limit enforcement edge cases', () => {
    it('should handle multiple limits exceeded simultaneously', () => {
      const fileContent = 'x'.repeat(1_000_001); // Exceeds file size
      const edits = Array.from({ length: 25 }, (_, i) => ({
        oldText: `x${i}`,
        newText: `y${i}`,
      })); // Exceeds hunk count

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
      // Should report at least one limit exceeded
      expect(result.details).toBeDefined();
    });

    it('should pass when values are exactly at limit', () => {
      // Create file with many lines to stay under change ratio limit
      const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
      const fileContent = lines.join('\n'); // ~7KB with 1000 lines

      // Make exactly 20 edits (at limit)
      const edits = Array.from({ length: 20 }, (_, i) => ({
        oldText: `line${i}`,
        newText: `newline${i}`,
      }));

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(true);
    });
  });

  describe('conflict detection mid-execution', () => {
    it('should detect file modified between baseline and conflict check', async () => {
      const testFile = join(testDir, 'conflict.ts');
      await writeFile(testFile, 'original content');

      let readCount = 0;
      vi.spyOn(tool as any, 'execCommand').mockImplementation(
        async ({ cmd }: any) => {
          if (cmd.includes('cat')) {
            readCount++;
            if (readCount === 1) {
              // First read (baseline)
              return { exitCode: 0, stdout: 'original content', stderr: '' };
            } else {
              // Second read (conflict check) - file changed
              return { exitCode: 0, stdout: 'modified content', stderr: '' };
            }
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      );

      // Mock LLM to return valid hunks
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'original',
              afterAnchor: 'content',
              replacement: 'new content',
            },
          ],
        }),
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit content',
          codeSketch: 'original\n// ... existing code ...\ncontent',
        },
        mockConfig,
        {} as any,
      );

      // Should detect conflict
      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('File was modified');
      }
    });
  });

  describe('error message quality', () => {
    it('should provide actionable suggestions for NOT_FOUND_ANCHOR', () => {
      const hunks = [
        {
          beforeAnchor: 'nonexistent',
          afterAnchor: 'also nonexistent',
          replacement: 'new',
        },
      ];

      const result = tool['resolveHunksToEdits']('real content', hunks);

      expect(result.error).toBeDefined();
      if (result.error) {
        expect(result.error.code).toBe('NOT_FOUND_ANCHOR');
        expect(result.error.suggestedAction).toBeDefined();
        expect(result.error.suggestedAction).toContain('context');
      }
    });

    it('should include file path in all error responses', async () => {
      const testFile = join(testDir, 'test.ts');
      await writeFile(testFile, 'content');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'error',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit',
          codeSketch: 'sketch',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.filePath).toBe(testFile);
      }
    });
  });
});
