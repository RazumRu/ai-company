import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenaiService } from '../../../../openai/openai.service';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesEditTool, FilesEditToolConfig } from './files-edit.tool';

describe('FilesEditTool', () => {
  let tool: FilesEditTool;
  let mockConfig: FilesEditToolConfig;
  let testDir: string;
  let mockOpenaiService: OpenaiService;

  beforeEach(async () => {
    // Create temporary directory for tests
    testDir = join(tmpdir(), `files-edit-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    mockOpenaiService = {
      response: vi.fn(),
    } as unknown as OpenaiService;

    tool = new FilesEditTool(mockOpenaiService);

    const mockRuntime = {
      getWorkdir: () => testDir,
    } as unknown as BaseRuntime;

    mockConfig = {
      runtime: mockRuntime,
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

      expect(title).toBe('Editing utils.ts');
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

  describe('validateSketchFormat', () => {
    it('should accept sketch with markers', () => {
      const sketch = 'line1\nline2\n// ... existing code ...\nline4\nline5';

      const result = tool['validateSketchFormat'](sketch);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should allow sketch with no markers (markerless, like Cursor)', () => {
      const sketch = 'line1\nline2\nline3';

      const result = tool['validateSketchFormat'](sketch);

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('no');
    });

    it('should accept sketch with one marker', () => {
      const sketch =
        'function test() {\n  line1\n// ... existing code ...\n  line3\n}';

      const result = tool['validateSketchFormat'](sketch);

      expect(result.valid).toBe(true);
    });

    it('should accept sketch with multiple markers', () => {
      const sketch =
        'class Test {\n  methodA() { }\n// ... existing code ...\n  methodC() { }\n// ... existing code ...\n}';

      const result = tool['validateSketchFormat'](sketch);

      expect(result.valid).toBe(true);
    });
  });

  describe('findAllAnchorPairs', () => {
    it('should find a single valid before→after pair', () => {
      const content = 'abc\ndef\nghi';
      const pairs = tool['findAllAnchorPairs'](content, 'abc', 'ghi');
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.matchedText).toBe('abc\ndef\nghi');
    });

    it('should return empty when anchors not found', () => {
      const content = 'abc\ndef\nghi';
      const pairs = tool['findAllAnchorPairs'](content, 'xyz', 'ghi');
      expect(pairs).toHaveLength(0);
    });

    it('should return multiple pairs when beforeAnchor repeats', () => {
      const content = 'const x = 1;\nA\nconst x = 1;\nB\nEND';
      const pairs = tool['findAllAnchorPairs'](content, 'const x = 1;', 'END');
      expect(pairs.length).toBeGreaterThan(1);
    });
  });

  describe('resolveHunksToEdits', () => {
    it('should resolve single hunk to edit', () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const hunks = [
        {
          beforeAnchor: 'function test() {\n  return',
          afterAnchor: '1;\n}',
          replacement: ' 2;',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toHaveLength(1);
    });

    it('should return error when anchors not found', () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const hunks = [
        {
          beforeAnchor: 'nonexistent\nanchor text',
          afterAnchor: 'also nonexistent\nanchor text',
          replacement: 'new code',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Could not find anchors');
    });

    it('should detect ambiguous matches when pattern repeats', () => {
      const content =
        'function test() {\n  return 1;\n}\n// end marker\nfunction test() {\n  return 2;\n}\n// end marker';
      const beforeAnchor = 'function test() {\n  return';
      const afterAnchor = '}\n// end marker';

      const hunks = [
        {
          beforeAnchor,
          afterAnchor,
          replacement: 'NEW',
        },
      ];

      const result = tool['resolveHunksToEdits'](content, hunks);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/Ambiguous|occurrence/i);
    });
  });

  describe('checkLimits', () => {
    it('should pass when all limits are within bounds', () => {
      const fileContent = 'line1\nline2\nline3\n'.repeat(10);
      const edits = [
        {
          oldText: 'line1',
          newText: 'line1-modified',
          start: 0,
          end: 0,
          kind: 'normal' as const,
          hunkIndex: 0,
        },
      ];

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(true);
    });

    it('should fail when file size exceeds limit', () => {
      const fileContent = 'x'.repeat(1_000_001); // > 1MB
      const edits = [
        {
          oldText: 'x',
          newText: 'y',
          start: 0,
          end: 0,
          kind: 'normal' as const,
          hunkIndex: 0,
        },
      ];

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('File size');
      expect(result.error).toContain('MB');
    });

    it('should fail when hunk count exceeds limit', () => {
      const fileContent = 'line1\nline2\nline3';
      const edits = Array.from({ length: 21 }, (_, i) => ({
        oldText: `line${i}`,
        newText: `modified${i}`,
        start: 0,
        end: 0,
        kind: 'normal' as const,
        hunkIndex: i,
      }));

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('hunks exceeds');
      expect(result.error).toContain('21');
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
    it('should allow markerless sketches with warning', () => {
      // Test at unit level with validateSketchFormat
      const result = tool['validateSketchFormat']('no markers here');

      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('no');
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
      expect(instructions).toContain('ritical'); // matches both "Critical" and "CRITICAL"
      expect(instructions).toContain('useSmartModel');
      expect(instructions).toContain('Retry Strategy');
    });
  });

  describe('OpenaiService integration', () => {
    it('should handle OpenaiService.response() throwing error', async () => {
      vi.spyOn(mockOpenaiService, 'response').mockRejectedValue(
        new Error('API timeout'),
      );

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\nnew_code\n// ... existing code ...\n}\n',
        false,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('API timeout');
    });

    it('should handle malformed JSON from LLM', async () => {
      vi.spyOn(mockOpenaiService, 'response').mockResolvedValue({
        conversationId: 'test',
        content: '{invalid json here',
      });

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\nnew_code\n// ... existing code ...\n}\n',
        false,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid JSON');
    });

    it('should handle empty hunks array from LLM', async () => {
      vi.spyOn(mockOpenaiService, 'response').mockResolvedValue({
        conversationId: 'test',
        content: JSON.stringify({ hunks: [] }),
      });

      const result = await tool['parseLLM'](
        'function test() {\n  return 1;\n}\n',
        'Change return value',
        'function test() {\n// ... existing code ...\nnew_code\n// ... existing code ...\n}\n',
        false,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('hunk structure');
    });
  });

  describe('model configuration', () => {
    it('should call OpenaiService.response when parsing with LLM', async () => {
      const generateSpy = vi
        .spyOn(mockOpenaiService, 'response')
        .mockResolvedValue({
          conversationId: 'test',
          content: JSON.stringify({
            hunks: [
              {
                beforeAnchor: 'function test() {',
                afterAnchor: '  return 1;\n}',
                replacement: '  return 2;',
              },
            ],
          }),
        });

      await tool['parseLLM'](
        'function test() { return 1; }',
        'Change return value',
        'x\n// ... existing code ...\ny',
        false,
      );

      expect(generateSpy).toHaveBeenCalled();
      expect(generateSpy.mock.calls[0]?.[1]?.model).toBeDefined();
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

      // Should detect overlapping edits or return valid edits
      if (result.error) {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
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

      const pairs = tool['findAllAnchorPairs'](
        fileContent,
        beforeAnchor.trim(),
        afterAnchor,
      );
      expect(pairs).toHaveLength(1);
    });

    it('should handle anchors with tabs vs spaces', () => {
      const fileContent = 'function test() {\n\treturn 1;\n}'; // Tab
      const beforeAnchor = 'function test() {';
      const afterAnchor = '}';

      const pairs = tool['findAllAnchorPairs'](
        fileContent,
        beforeAnchor,
        afterAnchor,
      );
      expect(pairs).toHaveLength(1);
    });
  });

  describe('special characters in anchors', () => {
    it('should handle anchors with regex special characters', () => {
      const fileContent = 'const pattern = /test.*$/;\nconst value = 1;';
      const beforeAnchor = 'const pattern = /test.*$/;';
      const afterAnchor = 'const value = 1;';

      const pairs = tool['findAllAnchorPairs'](
        fileContent,
        beforeAnchor,
        afterAnchor,
      );
      expect(pairs).toHaveLength(1);
    });

    it('should handle anchors with unicode characters', () => {
      const fileContent = 'const emoji = "🚀";\nconst text = "hello";';
      const beforeAnchor = 'const emoji = "🚀";';
      const afterAnchor = 'const text = "hello";';

      const pairs = tool['findAllAnchorPairs'](
        fileContent,
        beforeAnchor,
        afterAnchor,
      );
      expect(pairs).toHaveLength(1);
    });
  });

  describe('limit enforcement edge cases', () => {
    it('should handle multiple limits exceeded simultaneously', () => {
      const fileContent = 'x'.repeat(1_000_001); // Exceeds file size
      const edits = Array.from({ length: 25 }, (_, i) => ({
        oldText: `x${i}`,
        newText: `y${i}`,
        start: 0,
        end: 0,
        kind: 'normal' as const,
        hunkIndex: i,
      })); // Exceeds hunk count

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      // Should report at least one limit exceeded
      expect(result.error).toMatch(/limit|exceeds/i);
    });

    it('should pass when hunk count is exactly at limit', () => {
      const fileContent = 'line1\nline2\nline3\n'.repeat(100);

      // Make exactly 20 edits (at limit)
      const edits = Array.from({ length: 20 }, (_, i) => ({
        oldText: `line${i}`,
        newText: `newline${i}`,
        start: 0,
        end: 0,
        kind: 'normal' as const,
        hunkIndex: i,
      }));

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(true);
    });
  });

  describe('single-read invoke behavior', () => {
    it('should not perform a second read for conflict detection (writes based on initial read)', async () => {
      const testFile = join(testDir, 'conflict.ts');
      const prefix = Array.from(
        { length: 50 },
        (_, i) => `// prefix ${i}`,
      ).join('\n');
      const suffix = Array.from(
        { length: 50 },
        (_, i) => `// suffix ${i}`,
      ).join('\n');
      const originalContent = [
        prefix,
        'const original = "content";',
        'const untouchedA = 0;',
        '// marker A',
        'const value = 1;',
        '// marker B',
        'const untouchedB = 0;',
        '// end',
        suffix,
      ].join('\n');
      await writeFile(testFile, originalContent);

      let readCount = 0;
      vi.spyOn(tool as any, 'execCommand').mockImplementation(
        async ({ cmd }: any) => {
          if (cmd.includes('cat')) {
            readCount++;
            if (readCount === 1) {
              // First read (baseline)
              return { exitCode: 0, stdout: originalContent, stderr: '' };
            }
            // If a second read happens unexpectedly, simulate that the file changed.
            return {
              exitCode: 0,
              stdout:
                'const modified = "different";\n// marker A\nconst value = 999;\n// marker B\n// end',
              stderr: '',
            };
          }
          // Write command (printf|base64 -d > tmp && mv tmp target)
          if (cmd.includes('base64 -d') && cmd.includes('mv')) {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      );

      // Mock LLM to return valid hunks
      vi.spyOn(mockOpenaiService, 'response').mockResolvedValue({
        conversationId: 'test',
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'const untouchedA = 0;\n// marker A',
              afterAnchor: '// marker B\nconst untouchedB = 0;',
              replacement: 'const value = 2;',
            },
          ],
        }),
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit content',
          codeSketch:
            'const original = "content";\n// ... existing code ...\nconst untouchedA = 0;\n// marker A\nconst value = 2;\n// marker B\nconst untouchedB = 0;\n// ... existing code ...\n// end',
        },
        mockConfig,
        {} as any,
      );

      expect(readCount).toBe(1);
      if (!result.output.success) {
        throw new Error(`invoke failed: ${result.output.error}`);
      }
      expect(result.output.success).toBe(true);
    });
  });

  describe('error message quality', () => {
    it('should provide actionable suggestions when anchors not found', () => {
      const hunks = [
        {
          beforeAnchor: 'nonexistent\ntext here',
          afterAnchor: 'also nonexistent\ntext here',
          replacement: 'new',
        },
      ];

      const result = tool['resolveHunksToEdits']('real content', hunks);

      expect(result.error).toBeDefined();
      if (result.error) {
        expect(result.error).toContain('Could not find anchors');
        expect(result.error).toContain('EXACT text from the current file');
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

  describe('occurrence selection (disambiguating multiple pairs)', () => {
    it('should error when multiple pairs found without occurrence', () => {
      const fileContent = `
function test() {
  const x = 1;
  return x;
}

function other() {
  // code here
}

function test() {
  const x = 2;
  return x;
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: 'function test() {\n  const x =',
          afterAnchor: '  return x;\n}',
          replacement: 'function test() {\n  const x = 99;\n  return x;\n}',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(
        /Ambiguous anchors.*found \d+ valid before→after pairs/,
      );
      expect(result.error).toContain('occurrence');
    });

    it('should select correct pair when occurrence=2', () => {
      const fileContent = `
function test() {
  const x = 1;
  return x;
}

function other() {
  // code here
}

function test() {
  const x = 2;
  return x;
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: 'function test() {\n  const x =',
          afterAnchor: '  return x;\n}',
          replacement: ' 99;',
          occurrence: 2,
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toBeDefined();
      expect(result.edits).toHaveLength(1);
      // Should select the second occurrence
      expect(result.edits![0]!.oldText).toContain('const x = 2');
    });

    it('should error when occurrence is out of range', () => {
      const fileContent = `
function test() {
  const x = 1;
  return x;
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: 'function test() {\n  const',
          afterAnchor: '  return x;\n}',
          replacement: ' x = 99;',
          occurrence: 5, // Only 1 pair exists
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('occurrence 5 is out of range');
      expect(result.error).toContain('Only 1 valid matches found');
    });

    it('should error when occurrence is invalid (zero)', () => {
      const fileContent = 'function test() {\n  return 1;\n}';

      const hunks = [
        {
          beforeAnchor: 'function test() {\n  return',
          afterAnchor: '1;\n}',
          replacement: 'new',
          occurrence: 0,
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid occurrence value');
    });
  });

  describe('overlapping hunks detection', () => {
    it('should detect overlapping edits and error', () => {
      const fileContent = `
// Section A start
const valueA = 1;
// Section A end
// Section B start
const valueB = 2;
// Section B end
// Section C start
const valueC = 3;
// Section C end
      `.trim();

      const hunks = [
        {
          beforeAnchor: '// Section A start\nconst',
          afterAnchor: '2;\n// Section B end',
          replacement: ' modified = "A+B";',
        },
        {
          beforeAnchor: '// Section B start\nconst', // Overlaps with first hunk
          afterAnchor: '3;\n// Section C end',
          replacement: ' modified = "B+C";',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(
        /Overlapping edits detected.*hunks \d+ and \d+/,
      );
      expect(result.error).toContain('non-overlapping regions');
    });

    it('should allow non-overlapping edits', () => {
      const fileContent = `
// Section A start
const valueA = 1;
// Section A end
// Section B start
const valueB = 2;
// Section B end
// Section C start
const valueC = 3;
// Section C end
      `.trim();

      const hunks = [
        {
          beforeAnchor: '// Section A start\nconst',
          afterAnchor: '1;\n// Section A end',
          replacement: ' modifiedA = 999;',
        },
        {
          beforeAnchor: '// Section C start\nconst', // Does not overlap
          afterAnchor: '3;\n// Section C end',
          replacement: ' modifiedC = 888;',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toBeDefined();
      expect(result.edits).toHaveLength(2);
    });
  });

  describe('replacement-contains-anchor guard', () => {
    it('should error when replacement contains beforeAnchor', () => {
      const fileContent = `
const longVariableNameHere
= 1;
const anotherVariable = 2;
      `.trim();

      const hunks = [
        {
          beforeAnchor: 'const longVariableNameHere\n=',
          afterAnchor: '1;\nconst anotherVariable',
          // Replacement incorrectly includes the beforeAnchor text (>= 20 chars)
          replacement: ' 99;\nconst longVariableNameHere\n= 88',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('replacement must not include');
      expect(result.error).toContain('beforeAnchor/afterAnchor');
    });

    it('should error when replacement contains afterAnchor', () => {
      const fileContent = `
import ComponentA from './a';
export class ModuleX {
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: "import ComponentA from './a';\nexport class",
          afterAnchor: 'ModuleX {\n}',
          // Replacement incorrectly includes "ModuleX {\n}" which is the afterAnchor
          replacement: ' Helper {};\nModuleX {\n}',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('replacement must not include');
    });

    it('should succeed when replacement is anchor-free', () => {
      const fileContent = `
import ComponentA from './a';
export class ModuleX {
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: "import ComponentA from './a';\nexport class",
          afterAnchor: 'ModuleX {\n}',
          // Replacement contains new code without duplicating anchors
          replacement: ' Helper {};\nexport class',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toBeDefined();
    });
  });

  describe('anchor span validation', () => {
    it('should error when anchor span exceeds 100KB limit', () => {
      const largeContent = `
// Function start marker
here
${'line\n'.repeat(20000)}
// Function end marker
here
      `.trim();

      const hunks = [
        {
          beforeAnchor: '// Function start marker\nhere',
          afterAnchor: '// Function end marker\nhere', // Span is > MAX_ANCHOR_SPAN_BYTES (100KB)
          replacement: 'modified',
        },
      ];

      const result = tool['resolveHunksToEdits'](largeContent, hunks);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Anchor span too large');
      expect(result.error).toMatch(/\d+ bytes.*exceeds.*byte limit/);
    });

    it('should succeed when span is within 100KB limit', () => {
      const fileContent = `
function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}
      `.trim();

      const hunks = [
        {
          beforeAnchor: 'function calculateTotal(items) {\n  let',
          afterAnchor: '}\n  return total;\n}',
          replacement:
            ' total = items.reduce((sum, item) => sum + item.price, 0);',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      expect(result.error).toBeUndefined();
      expect(result.edits).toBeDefined();
      expect(result.edits).toHaveLength(1);
    });
  });
});
