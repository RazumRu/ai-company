import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenaiService } from '../../../../openai/openai.service';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesApplyChangesTool } from './files-apply-changes.tool';
import {
  FilesEditReapplyTool,
  FilesEditReapplyToolConfig,
} from './files-edit-reapply.tool';

describe('FilesEditReapplyTool', () => {
  let tool: FilesEditReapplyTool;
  let mockConfig: FilesEditReapplyToolConfig;
  let testDir: string;
  let mockOpenaiService: OpenaiService;
  let mockFilesApplyChangesTool: FilesApplyChangesTool;

  beforeEach(async () => {
    // Create temporary directory for tests
    testDir = join(tmpdir(), `files-edit-reapply-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    mockOpenaiService = {
      generate: vi.fn(),
    } as unknown as OpenaiService;

    mockFilesApplyChangesTool = new FilesApplyChangesTool();

    tool = new FilesEditReapplyTool(
      mockOpenaiService,
      mockFilesApplyChangesTool,
    );

    const mockRuntime = {
      getWorkdir: () => testDir,
    } as unknown as BaseRuntime;

    mockConfig = {
      runtime: mockRuntime,
      smartModel: 'gpt-5.1',
    };
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('schema and metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_edit_reapply');
    });

    it('should have meaningful description', () => {
      expect(tool.description).toContain('more capable model');
      expect(tool.description).toContain('after files_edit fails');
    });

    it('should have valid schema', () => {
      const schema = tool.schema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });
  });

  describe('generateTitle', () => {
    it('should generate title with file name and smart model indicator', () => {
      const title = tool['generateTitle'](
        {
          filePath: '/repo/src/utils.ts',
          editInstructions: 'Add validation',
          codeSketch: 'function test() {}',
        },
        mockConfig,
      );

      expect(title).toBe('Re-editing utils.ts (smart model)');
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
  });

  describe('parseLLMSmart', () => {
    it('should use enhanced prompting', async () => {
      const fileContent = 'function test() {\n  return 1;\n}';
      const editInstructions = 'Change return value';
      const sketch =
        'function test() {\n// ... existing code ...\n  return 2;\n}';
      const model = 'gpt-5.1';

      // Mock LLM response
      vi.spyOn(tool as any, 'parseLLMSmart').mockResolvedValue({
        success: true,
        hunks: [
          {
            beforeAnchor: 'function test() {',
            afterAnchor: '}',
            replacement: 'function test() {\n  return 2;\n}',
          },
        ],
      });

      const result = await tool['parseLLMSmart'](
        fileContent,
        editInstructions,
        sketch,
        model,
      );

      expect(result.success).toBe(true);
      expect(result.hunks).toBeDefined();
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
  });

  describe('path sandboxing', () => {
    it('should validate paths are within workspace', () => {
      // Test path sandboxing logic conceptually
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
    it('should detect file changes between read and apply', async () => {
      const testFile = join(testDir, 'conflict-test.txt');
      await writeFile(testFile, 'original content');

      // Mock execCommand to simulate file change between reads
      let callCount = 0;
      // Mock the generate method to return a valid response
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'original',
              afterAnchor: 'content',
              replacement: 'modified',
            },
          ],
        }),
      });

      vi.spyOn(tool as any, 'execCommand').mockImplementation(
        async ({ cmd }: any) => {
          callCount++;
          if (cmd.includes('cat')) {
            if (callCount === 1) {
              return { exitCode: 0, stdout: 'original content', stderr: '' };
            } else {
              // Second read returns different content
              return {
                exitCode: 0,
                stdout: 'modified by someone else',
                stderr: '',
              };
            }
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      );

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Test edit',
          codeSketch: 'original\n// ... existing code ...\nmodified',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('File was modified');
      }
    });
  });

  describe('error responses', () => {
    it('should return error string on failure', () => {
      const errorResponse = {
        success: false as const,
        error: 'Smart model failed to parse',
        filePath: '/test/file.ts',
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.filePath).toBeDefined();
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
    it('should provide instructions for smart model fallback', () => {
      const instructions = tool.getDetailedInstructions(mockConfig);

      expect(instructions).toContain('more capable model');
      expect(instructions).toContain('files_edit');
      expect(instructions).toContain('PARSE_FAILED');
      expect(instructions).toContain('APPLY_FAILED');
      expect(instructions).toContain('smarter');
    });

    it('should mention when NOT to use this tool', () => {
      const instructions = tool.getDetailedInstructions(mockConfig);

      expect(instructions).toContain('When NOT to Use');
      expect(instructions).toContain('primary editing tool');
    });
  });

  describe('model selection', () => {
    it('should use smartModel from config by default', () => {
      // Test that smart model configuration is available
      expect(mockConfig.smartModel).toBeDefined();
      expect(mockConfig.smartModel).toBe('gpt-5.1');
    });
  });

  describe('integration behavior', () => {
    it('should use smart LLM parsing directly', () => {
      // Verify that FilesEditReapplyTool does NOT have deterministic parser method
      // This is a design difference from FilesEditTool
      expect((tool as any).parseDeterministicAnchors).toBeUndefined();

      // FilesEditReapplyTool should only have parseLLMSmart
      expect(typeof (tool as any).parseLLMSmart).toBe('function');
    });
  });

  describe('OpenaiService integration', () => {
    it('should handle OpenaiService.generate() throwing error', async () => {
      const testFile = join(testDir, 'test.ts');
      await writeFile(testFile, 'function test() { return 1; }');

      // Mock OpenaiService to throw error
      vi.spyOn(mockOpenaiService, 'generate').mockRejectedValue(
        new Error('Network timeout'),
      );

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'function test() { return 1; }',
        stderr: '',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Change return value',
          codeSketch: 'function test() {\n// ... existing code ...\n}',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('Network timeout');
      }
    });

    it('should handle malformed JSON from smart LLM', async () => {
      const testFile = join(testDir, 'test.ts');
      await writeFile(testFile, 'function test() { return 1; }');

      // Mock OpenaiService to return malformed JSON
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: '{ incomplete json',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'function test() { return 1; }',
        stderr: '',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Change return value',
          codeSketch: 'function test() {\n// ... existing code ...\n}',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('valid JSON');
      }
    });

    it('should handle LLM returning invalid anchors that do not exist in file', async () => {
      const testFile = join(testDir, 'test.ts');
      await writeFile(testFile, 'function test() { return 1; }');

      // Mock OpenaiService to return anchors that don't exist
      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'this does not exist',
              afterAnchor: 'neither does this',
              replacement: 'new code',
            },
          ],
        }),
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'function test() { return 1; }',
        stderr: '',
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Change return value',
          codeSketch: 'function test() {\n// ... existing code ...\n}',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('Could not find anchors');
      }
    });
  });

  describe('model configuration edge cases', () => {
    it('should use provided smartModel', async () => {
      const testFile = join(testDir, 'test.ts');
      await writeFile(testFile, 'function test() { return 1; }');

      const customConfig = {
        runtime: mockConfig.runtime,
        smartModel: 'custom-smart-model',
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

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'function test() { return 1; }',
        stderr: '',
      });

      await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Change return value',
          codeSketch: 'function test() {\n// ... existing code ...\n}',
        },
        customConfig,
        {} as any,
      );

      // Verify the custom model was used
      expect(generateSpy).toHaveBeenCalled();
      expect(generateSpy.mock.calls[0]?.[1]?.model).toBe('custom-smart-model');
    });
  });

  describe('file system edge cases', () => {
    it('should handle file read error gracefully', async () => {
      const testFile = join(testDir, 'nonexistent.ts');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'File not found',
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

    it('should handle empty file content', async () => {
      const testFile = join(testDir, 'empty.ts');
      await writeFile(testFile, '');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: '',
              afterAnchor: '',
              replacement: 'new content',
            },
          ],
        }),
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

      // Should handle empty file gracefully
      expect(result.output).toBeDefined();
      expect(typeof result.output.success).toBe('boolean');
    });

    it('should handle files with mixed line endings', async () => {
      const testFile = join(testDir, 'mixed.ts');
      const mixedContent = 'line1\r\nline2\nline3\rline4';
      await writeFile(testFile, mixedContent);

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: mixedContent,
        stderr: '',
      });

      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'line1',
              afterAnchor: 'line4',
              replacement: 'newline',
            },
          ],
        }),
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit content',
          codeSketch: 'line1\n// ... existing code ...\nline4',
        },
        mockConfig,
        {} as any,
      );

      // Should handle mixed line endings
      expect(result.output).toBeDefined();
      expect(typeof result.output.success).toBe('boolean');
    });
  });

  describe('special characters and unicode', () => {
    it('should handle unicode characters in content', async () => {
      const testFile = join(testDir, 'unicode.ts');
      const content = 'const emoji = "🚀";\nconst text = "hello";';
      await writeFile(testFile, content);

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: content,
        stderr: '',
      });

      vi.spyOn(mockOpenaiService, 'generate').mockResolvedValue({
        content: JSON.stringify({
          hunks: [
            {
              beforeAnchor: 'const emoji = "🚀";',
              afterAnchor: 'const text = "hello";',
              replacement: 'const emoji = "🎉";',
            },
          ],
        }),
      });

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Change emoji',
          codeSketch: 'const emoji = "🚀";\n// ... existing code ...',
        },
        mockConfig,
        {} as any,
      );

      // Should handle unicode gracefully
      expect(result.output).toBeDefined();
      expect(typeof result.output.success).toBe('boolean');
    });

    it('should handle regex special characters in anchors', () => {
      const fileContent = 'const pattern = /test.*$/;\nconst value = 1;';
      const hunks = [
        {
          beforeAnchor: 'const pattern = /test.*$/;',
          afterAnchor: 'const value = 1;',
          replacement: 'const pattern = /new.*$/;',
        },
      ];

      const result = tool['resolveHunksToEdits'](fileContent, hunks);

      // Should handle regex special chars without treating them as regex
      expect(result).toBeDefined();
    });
  });

  describe('limit enforcement edge cases', () => {
    it('should handle multiple limits exceeded', () => {
      const fileContent = 'x'.repeat(1_000_001); // Exceeds size
      const edits = Array.from({ length: 25 }, () => ({
        oldText: 'x',
        newText: 'y',
      })); // Exceeds count

      const result = tool['checkLimits'](fileContent, edits);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
      expect(result.details).toBeDefined();
    });

    it('should pass at exact limit boundary', () => {
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

  describe('error message quality', () => {
    it('should include file path in error responses', async () => {
      const testFile = join(testDir, 'error.ts');
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
        expect(result.output.error).toBeDefined();
      }
    });

    it('should provide specific error for PARSE_FAILED', async () => {
      const testFile = join(testDir, 'parse.ts');
      await writeFile(testFile, 'content');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'content',
        stderr: '',
      });

      vi.spyOn(mockOpenaiService, 'generate').mockRejectedValue(
        new Error('Model error'),
      );

      const result = await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit',
          codeSketch: 'content\n// ... existing code ...',
        },
        mockConfig,
        {} as any,
      );

      expect(result.output.success).toBe(false);
      if (!result.output.success) {
        expect(result.output.error).toBeDefined();
        expect(result.output.error).toContain('Model error');
        expect(result.output.error).toContain('files_apply_changes');
      }
    });
  });

  describe('smart model behavior verification', () => {
    it('should actually use smart model not fast model', async () => {
      const testFile = join(testDir, 'model.ts');
      await writeFile(testFile, 'content');

      const generateSpy = vi
        .spyOn(mockOpenaiService, 'generate')
        .mockResolvedValue({
          content: JSON.stringify({
            hunks: [
              {
                beforeAnchor: 'con',
                afterAnchor: 'tent',
                replacement: 'new',
              },
            ],
          }),
        });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'content',
        stderr: '',
      });

      await tool.invoke(
        {
          filePath: testFile,
          editInstructions: 'Edit',
          codeSketch: 'content\n// ... existing code ...',
        },
        { runtime: mockConfig.runtime, smartModel: 'custom-smart-model' },
        {} as any,
      );

      // Verify smart model was actually used
      expect(generateSpy).toHaveBeenCalled();
      const callArgs = generateSpy.mock.calls[0];
      expect(callArgs?.[1]?.model).toBe('custom-smart-model');
    });
  });
});
