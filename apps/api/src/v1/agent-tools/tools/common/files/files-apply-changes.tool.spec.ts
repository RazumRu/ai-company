import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FilesApplyChangesTool,
  FilesApplyChangesToolSchema,
} from './files-apply-changes.tool';
import { FilesBaseToolConfig } from './files-base.tool';

describe('FilesApplyChangesTool', () => {
  let tool: FilesApplyChangesTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(() => {
    tool = new FilesApplyChangesTool();
    mockConfig = {
      runtime: vi.fn(),
    } as unknown as FilesBaseToolConfig;
  });

  describe('schema', () => {
    it('should have correct schema structure', () => {
      const schema = FilesApplyChangesToolSchema;
      expect(schema).toBeDefined();

      const parsed = schema.safeParse({
        filePath: '/test/file.ts',
        oldText: 'old',
        newText: 'new',
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept replaceAll flag', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: 'old',
        newText: 'new',
        replaceAll: true,
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept replaceAll as false', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: 'old',
        newText: 'new',
        replaceAll: false,
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe('name and description', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_apply_changes');
    });

    it('should have meaningful description', () => {
      expect(tool.description).toContain('targeted text edits');
      expect(tool.description).toContain('oldText');
      expect(tool.description).toContain('newText');
    });
  });

  describe('generateTitle', () => {
    it('should generate title with file name for edit mode', () => {
      const title = tool['generateTitle'](
        {
          filePath: '/repo/src/utils.ts',
          oldText: 'old',
          newText: 'new',
        },
        mockConfig,
      );

      expect(title).toBe('Editing utils.ts (edit)');
    });

    it('should generate title with replace all mode', () => {
      const title = tool['generateTitle'](
        {
          filePath: '/repo/src/app.ts',
          oldText: 'old',
          newText: 'new',
          replaceAll: true,
        },
        mockConfig,
      );

      expect(title).toBe('Editing app.ts (replace all)');
    });
  });

  describe('normalizeWhitespace', () => {
    it('should trim each line and overall', () => {
      const result = tool['normalizeWhitespace']('  hello world  ');
      expect(result).toBe('hello world');
    });

    it('should trim leading and trailing whitespace', () => {
      const result = tool['normalizeWhitespace']('  hello  ');
      expect(result).toBe('hello');
    });

    it('should normalize whitespace in multiline text', () => {
      const result = tool['normalizeWhitespace']('  line1  \n  line2  ');
      expect(result).toBe('line1\nline2');
    });
  });

  describe('detectIndentationFromBlock', () => {
    it('should detect spaces indentation', () => {
      const result = tool['detectIndentationFromBlock']('    code');
      expect(result).toBe('    ');
    });

    it('should detect tabs indentation', () => {
      const result = tool['detectIndentationFromBlock']('\t\tcode');
      expect(result).toBe('\t\t');
    });

    it('should return empty string for no indentation', () => {
      const result = tool['detectIndentationFromBlock']('code');
      expect(result).toBe('');
    });
  });

  describe('applyIndentation', () => {
    it('should apply indentation to all lines including first', () => {
      const result = tool['applyIndentation']('line1\nline2\nline3', '  ');
      expect(result).toBe('  line1\n  line2\n  line3');
    });

    it('should not indent empty lines', () => {
      const result = tool['applyIndentation']('line1\n\nline3', '  ');
      expect(result).toBe('  line1\n\n  line3');
    });

    it('should return original if no indentation', () => {
      const result = tool['applyIndentation']('line1\nline2', '');
      expect(result).toBe('line1\nline2');
    });
  });

  describe('findMatches', () => {
    it('should find single match', () => {
      const fileContent = 'line1\nline2\nline3';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'line2',
        false,
      );

      expect(matches).toHaveLength(1);
      expect(errors).toHaveLength(0);
      const match = matches[0]!;
      expect(match.startLine).toBe(1);
      expect(match.endLine).toBe(1);
    });

    it('should find multiline match', () => {
      const fileContent = 'line1\nline2\nline3\nline4';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'line2\nline3',
        false,
      );

      expect(matches).toHaveLength(1);
      expect(errors).toHaveLength(0);
      const match = matches[0]!;
      expect(match.startLine).toBe(1);
      expect(match.endLine).toBe(2);
    });

    it('should handle whitespace normalization', () => {
      const fileContent = '  line1  \n  line2  ';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'line1\nline2',
        false,
      );

      expect(matches).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('should detect when no match found', () => {
      const fileContent = 'line1\nline2';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'nonexistent',
        false,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Could not find match');
    });

    it('should detect multiple matches when replaceAll is false', () => {
      const fileContent = 'line1\nline1\nline1';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'line1',
        false,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Found 3 matches');
      expect(errors[0]).toContain('replaceAll');
    });

    it('should find all matches when replaceAll is true', () => {
      const fileContent = 'line1\nline1\nline1';

      const { matches, errors } = tool['findMatches'](
        fileContent,
        'line1',
        true,
      );

      expect(matches).toHaveLength(3);
      expect(errors).toHaveLength(0);
    });

    it('should skip when oldText is empty', () => {
      const fileContent = 'line1\nline2';

      const { matches, errors } = tool['findMatches'](fileContent, '', false);

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe('generateDiff', () => {
    it('should generate basic diff', () => {
      const originalLines = ['line1', 'line2', 'line3'];
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 1,
          matchedText: 'line2',
          indentation: '',
        },
      ];

      const diff = tool['generateDiff'](originalLines, matches, 'modified');

      expect(diff).toContain('-line2');
      expect(diff).toContain('+modified');
    });

    it('should include context lines', () => {
      const originalLines = ['line1', 'line2', 'line3', 'line4', 'line5'];
      const matches = [
        {
          editIndex: 0,
          startLine: 2,
          endLine: 2,
          matchedText: 'line3',
          indentation: '',
        },
      ];

      const diff = tool['generateDiff'](originalLines, matches, 'modified');

      expect(diff).toContain(' line1');
      expect(diff).toContain(' line2');
      expect(diff).toContain('-line3');
      expect(diff).toContain('+modified');
      expect(diff).toContain(' line4');
      expect(diff).toContain(' line5');
    });

    it('should generate diff for multiple matches', () => {
      const originalLines = ['line1', 'line2', 'line3', 'line2'];
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 1,
          matchedText: 'line2',
          indentation: '',
        },
        {
          editIndex: 0,
          startLine: 3,
          endLine: 3,
          matchedText: 'line2',
          indentation: '',
        },
      ];

      const diff = tool['generateDiff'](originalLines, matches, 'modified');

      expect(diff).toContain('-line2');
      expect(diff).toContain('+modified');
      // Should have two replacements
      const minusCount = (diff.match(/-line2/g) || []).length;
      expect(minusCount).toBe(2);
    });
  });

  describe('applyEdits', () => {
    it('should apply single edit', () => {
      const fileContent = 'line1\nline2\nline3';
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 1,
          matchedText: 'line2',
          indentation: '',
        },
      ];

      const result = tool['applyEdits'](fileContent, matches, 'modified');

      expect(result).toBe('line1\nmodified\nline3');
    });

    it('should apply multiple edits from bottom to top', () => {
      const fileContent = 'line1\nline2\nline3\nline2';
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 1,
          matchedText: 'line2',
          indentation: '',
        },
        {
          editIndex: 0,
          startLine: 3,
          endLine: 3,
          matchedText: 'line2',
          indentation: '',
        },
      ];

      const result = tool['applyEdits'](fileContent, matches, 'modified');

      expect(result).toBe('line1\nmodified\nline3\nmodified');
    });

    it('should preserve indentation', () => {
      const fileContent = 'line1\n  line2\nline3';
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 1,
          matchedText: '  line2',
          indentation: '  ',
        },
      ];

      const result = tool['applyEdits'](
        fileContent,
        matches,
        'mod2\nmod2line2',
      );

      // All lines of replacement get the indentation of the matched location
      expect(result).toBe('line1\n  mod2\n  mod2line2\nline3');
    });

    it('should handle multiline replacements', () => {
      const fileContent = 'line1\nline2\nline3\nline4';
      const matches = [
        {
          editIndex: 0,
          startLine: 1,
          endLine: 2,
          matchedText: 'line2\nline3',
          indentation: '',
        },
      ];

      const result = tool['applyEdits'](fileContent, matches, 'modified');

      expect(result).toBe('line1\nmodified\nline4');
    });
  });

  describe('getDetailedInstructions', () => {
    it('should return detailed instructions', () => {
      const instructions = tool.getDetailedInstructions(mockConfig);

      expect(instructions).toBeDefined();
      expect(instructions).toContain('### Overview');
      expect(instructions).toContain('### When to Use');
      expect(instructions).toContain('oldText');
      expect(instructions).toContain('newText');
      expect(instructions).toContain('replaceAll');
    });
  });
});
