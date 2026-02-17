import { ToolRunnableConfig } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
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
      runtimeProvider: { provide: vi.fn() } as any,
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
      expect(tool.description).toContain('Replace exact text blocks');
      expect(tool.description).toContain('oldText');
      expect(tool.description).toContain('files_read');
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

      expect(title).toBe('Editing utils.ts');
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

      expect(title).toBe('Editing app.ts');
    });
  });

  describe('normalizeWhitespace', () => {
    it('should trim each line and overall', () => {
      const result = tool['normalizeWhitespace']('  hello world  ', false);
      expect(result).toBe('hello world');
    });

    it('should trim leading and trailing whitespace', () => {
      const result = tool['normalizeWhitespace']('  hello  ', false);
      expect(result).toBe('hello');
    });

    it('should normalize whitespace in multiline text', () => {
      const result = tool['normalizeWhitespace']('  line1  \n  line2  ', false);
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
      const lines = ['line1', 'line2', 'line3'];

      const { matches, errors } = tool['findMatches'](lines, 'line2', false);

      expect(matches).toHaveLength(1);
      expect(errors).toHaveLength(0);
      const match = matches[0]!;
      expect(match.startLine).toBe(1);
      expect(match.endLine).toBe(1);
    });

    it('should find multiline match', () => {
      const lines = ['line1', 'line2', 'line3', 'line4'];

      const { matches, errors } = tool['findMatches'](
        lines,
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
      const lines = ['  line1  ', '  line2  '];

      const { matches, errors } = tool['findMatches'](
        lines,
        '  line1\n  line2',
        false,
      );

      expect(matches).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('should detect when no match found', () => {
      const lines = ['line1', 'line2'];

      const { matches, errors } = tool['findMatches'](
        lines,
        'nonexistent',
        false,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Could not find match');
    });

    it('should detect multiple matches when replaceAll is false', () => {
      const lines = ['line1', 'line1', 'line1'];

      const { matches, errors } = tool['findMatches'](lines, 'line1', false);

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Found 3 matches');
      expect(errors[0]).toContain('replaceAll');
    });

    it('should find all matches when replaceAll is true', () => {
      const lines = ['line1', 'line1', 'line1'];

      const { matches, errors } = tool['findMatches'](lines, 'line1', true);

      expect(matches).toHaveLength(3);
      expect(errors).toHaveLength(0);
    });

    it('should skip when oldText is empty', () => {
      const lines = ['line1', 'line2'];

      const { matches, errors } = tool['findMatches'](lines, '', false);

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
      const originalLines = [
        'line0',
        'line1',
        'line2',
        'line3',
        'line4',
        'line5',
        'line6',
        'line7',
        'line8',
        'line9',
        'line10',
      ];
      const matches = [
        {
          editIndex: 0,
          startLine: 5,
          endLine: 5,
          matchedText: 'line5',
          indentation: '',
        },
      ];

      const diff = tool['generateDiff'](originalLines, matches, 'modified');

      // With 5 lines of context before/after
      expect(diff).toContain(' line1');
      expect(diff).toContain(' line4');
      expect(diff).toContain('-line5');
      expect(diff).toContain('+modified');
      expect(diff).toContain(' line6');
      expect(diff).toContain(' line10');
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
      expect(instructions).toContain('### How to Use');
      expect(instructions).toContain('oldText');
      expect(instructions).toContain('newText');
      expect(instructions).toContain('replaceAll');
    });
  });

  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(tool['levenshteinDistance']('hello', 'hello')).toBe(0);
    });

    it('should return length of other string when one is empty', () => {
      expect(tool['levenshteinDistance']('', 'abc')).toBe(3);
      expect(tool['levenshteinDistance']('abc', '')).toBe(3);
    });

    it('should compute single character substitution', () => {
      expect(tool['levenshteinDistance']('cat', 'bat')).toBe(1);
    });

    it('should compute single character insertion', () => {
      expect(tool['levenshteinDistance']('cat', 'cats')).toBe(1);
    });

    it('should compute single character deletion', () => {
      expect(tool['levenshteinDistance']('cats', 'cat')).toBe(1);
    });

    it('should compute distance for completely different strings', () => {
      expect(tool['levenshteinDistance']('abc', 'xyz')).toBe(3);
    });

    it('should handle quote style differences', () => {
      // "hello" vs 'hello' — 2 substitutions (both quote chars)
      expect(tool['levenshteinDistance']('"hello"', "'hello'")).toBe(2);
    });
  });

  describe('findMatchesTrimmed (Stage 2 - trimmed matching)', () => {
    it('should match when oldText has wrong indentation', () => {
      const fileContent = '  function foo() {\n    return 1;\n  }';
      const oldText = 'function foo() {\n  return 1;\n}';
      const originalLines = fileContent.split('\n');

      const { matches, errors } = tool['findMatchesTrimmed'](
        originalLines,
        oldText,
        false,
      );

      expect(errors).toHaveLength(0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.startLine).toBe(0);
      expect(matches[0]!.endLine).toBe(2);
      // Should preserve original file indentation
      expect(matches[0]!.indentation).toBe('  ');
    });

    it('should find multiple matches with replaceAll', () => {
      const fileContent = '  x = 1\n  y = 2\n  x = 1\n  z = 3';
      const originalLines = fileContent.split('\n');
      const oldText = 'x = 1';

      const { matches, errors } = tool['findMatchesTrimmed'](
        originalLines,
        oldText,
        true,
      );

      expect(errors).toHaveLength(0);
      expect(matches).toHaveLength(2);
      expect(matches[0]!.startLine).toBe(0);
      expect(matches[1]!.startLine).toBe(2);
    });

    it('should error on multiple matches without replaceAll', () => {
      const fileContent = '  x = 1\n  y = 2\n  x = 1';
      const originalLines = fileContent.split('\n');
      const oldText = 'x = 1';

      const { matches, errors } = tool['findMatchesTrimmed'](
        originalLines,
        oldText,
        false,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Found 2 trimmed matches');
    });

    it('should not produce overlapping matches', () => {
      // 3-line block repeated with overlap potential
      const fileContent = 'a\nb\nc\nb\nc\nd';
      const originalLines = fileContent.split('\n');
      const oldText = 'b\nc';

      const { matches } = tool['findMatchesTrimmed'](
        originalLines,
        oldText,
        true,
      );

      // Should find 2 non-overlapping matches, not 3 overlapping ones
      expect(matches).toHaveLength(2);
      expect(matches[0]!.startLine).toBe(1);
      expect(matches[0]!.endLine).toBe(2);
      expect(matches[1]!.startLine).toBe(3);
      expect(matches[1]!.endLine).toBe(4);
    });

    it('should return empty when no match found', () => {
      const fileContent = 'hello world';
      const originalLines = fileContent.split('\n');

      const { matches, errors } = tool['findMatchesTrimmed'](
        originalLines,
        'nonexistent',
        false,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });

  describe('findMatchesFuzzy (Stage 3 - fuzzy matching)', () => {
    it('should match with minor typo difference', () => {
      const fileContent = 'const x = "hello";\nreturn x;';
      const originalLines = fileContent.split('\n');
      // Single quote instead of double quote — small Levenshtein distance
      const oldText = "const x = 'hello';";

      const { matches, errors } = tool['findMatchesFuzzy'](
        originalLines,
        oldText,
      );

      expect(errors).toHaveLength(0);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.startLine).toBe(0);
    });

    it('should reject match exceeding 15% edit ratio', () => {
      const fileContent = 'abcdefghij';
      const originalLines = fileContent.split('\n');
      // >15% different
      const oldText = 'xyzdefghij';

      const { matches } = tool['findMatchesFuzzy'](originalLines, oldText);

      // 3 edits on 10 chars = 30% — should not match
      expect(matches).toHaveLength(0);
    });

    it('should reject multiple fuzzy matches as ambiguous', () => {
      // Both lines are identical except for quote style — both within 15% threshold
      const fileContent =
        'const a = "hello";\nconst b = 2;\nconst a = "hello";';
      const originalLines = fileContent.split('\n');
      // Fuzzy-matches both line 0 and line 2 (same edit distance)
      const oldText = "const a = 'hello';";

      const { matches, errors } = tool['findMatchesFuzzy'](
        originalLines,
        oldText,
      );

      // Multiple candidates should be rejected
      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('too ambiguous');
    });

    it('should skip fuzzy matching for large oldText (>50 lines)', () => {
      const fileLines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
      const fileContent = fileLines.join('\n');
      const originalLines = fileContent.split('\n');
      // 51 lines — exceeds MAX_FUZZY_OLD_TEXT_LINES
      const oldText = Array.from({ length: 51 }, (_, i) => `line ${i}`).join(
        '\n',
      );

      const { matches, errors } = tool['findMatchesFuzzy'](
        originalLines,
        oldText,
      );

      expect(matches).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });

    it('should not produce overlapping matches', () => {
      // Two similar but not identical blocks
      const fileContent = 'const a = "x";\nconst b = 2;\nconst a = "y";';
      const originalLines = fileContent.split('\n');
      // Fuzzy-matches line 0 ('x' vs 'z')
      const oldText = 'const a = "z";';

      const { matches } = tool['findMatchesFuzzy'](originalLines, oldText);

      // All matches should be non-overlapping
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i]!.startLine).toBeGreaterThan(matches[i - 1]!.endLine);
      }
    });

    it('should require exact trimmed match for short lines (<8 chars)', () => {
      // "}" is only 1 char — fuzzy should NOT match ")" even though edit distance is 1
      const fileContent = '  }\n  return;\n  ]';
      const originalLines = fileContent.split('\n');
      const oldText = ')';

      const { matches } = tool['findMatchesFuzzy'](originalLines, oldText);

      // Short line fuzzy guard: ")" vs "}" should not fuzzy-match
      expect(matches).toHaveLength(0);
    });

    it('should fuzzy-match lines >= 8 chars with small difference', () => {
      // 18-char line, 1-char difference = ~5.5% edit ratio — within 15% threshold
      const fileContent = 'const x = "value";';
      const originalLines = fileContent.split('\n');
      const oldText = "const x = 'value';";

      const { matches } = tool['findMatchesFuzzy'](originalLines, oldText);

      expect(matches).toHaveLength(1);
    });
  });

  describe('findMatchesProgressive (full pipeline)', () => {
    it('should prefer exact match (stage 1)', () => {
      const fileContent = 'line1\nline2\nline3';

      const result = tool['findMatchesProgressive'](
        fileContent,
        'line2',
        false,
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matchStage).toBe('exact');
    });

    it('should fall back to trimmed match when exact fails', () => {
      const fileContent = '    line1\n    line2\n    line3';
      // No indentation — won't match exact, but will match trimmed
      const oldText = 'line1\nline2\nline3';

      const result = tool['findMatchesProgressive'](
        fileContent,
        oldText,
        false,
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matchStage).toBe('trimmed');
    });

    it('should fall back to fuzzy match when trimmed fails', () => {
      const fileContent = 'const x = "hello";\nreturn x;';
      // Single vs double quotes — trimmed won't match, fuzzy will
      const oldText = "const x = 'hello';";

      const result = tool['findMatchesProgressive'](
        fileContent,
        oldText,
        false,
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matchStage).toBe('fuzzy');
    });

    it('should not try fuzzy when replaceAll is true', () => {
      const fileContent = 'const x = "hello";\nreturn x;';
      const oldText = "const x = 'hello';";

      const result = tool['findMatchesProgressive'](fileContent, oldText, true);

      // Fuzzy is skipped for replaceAll, so no match found
      expect(result.matches).toHaveLength(0);
      expect(result.matchStage).toBeUndefined();
    });

    it('should not try fallback stages when stage 1 finds ambiguous matches', () => {
      const fileContent = '  x\n  y\n  x';
      // Two exact matches without replaceAll — stage 1 error, no fallback
      const oldText = '  x';

      const result = tool['findMatchesProgressive'](
        fileContent,
        oldText,
        false,
      );

      expect(result.matches).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Found 2 matches');
      expect(result.matchStage).toBeUndefined();
    });

    it('should match when oldText has trailing newline', () => {
      const fileContent =
        "import { A } from './a';\nimport { B } from './b';\nimport { C } from './c';";
      // Trailing \n produces a phantom empty line — should still match
      const oldText = "import { B } from './b';\n";

      const result = tool['findMatchesProgressive'](
        fileContent,
        oldText,
        false,
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.matchedText).toBe("import { B } from './b';");
    });

    it('should match when oldText has leading and trailing newlines', () => {
      const fileContent = 'line1\nline2\nline3';
      const oldText = '\nline2\n';

      const result = tool['findMatchesProgressive'](
        fileContent,
        oldText,
        false,
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.matchedText).toBe('line2');
    });

    it('should return stage 1 errors when all stages fail', () => {
      const fileContent = 'hello world';

      const result = tool['findMatchesProgressive'](
        fileContent,
        'completely different text that does not exist anywhere',
        false,
      );

      expect(result.matches).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Could not find match');
    });
  });

  describe('schema — new fields', () => {
    it('should accept insertAfterLine parameter', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: '',
        newText: 'new line',
        insertAfterLine: 5,
      });

      expect(parsed.success).toBe(true);
    });

    it('should reject negative insertAfterLine', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: '',
        newText: 'new line',
        insertAfterLine: -1,
      });

      expect(parsed.success).toBe(false);
    });

    it('should accept insertAfterLine 0 (beginning of file)', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: '',
        newText: 'new line',
        insertAfterLine: 0,
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe('multi-edit schema', () => {
    it('should accept edits array', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits: [
          { oldText: 'old1', newText: 'new1' },
          { oldText: 'old2', newText: 'new2' },
        ],
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept edits array with replaceAll', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits: [{ oldText: 'old1', newText: 'new1', replaceAll: true }],
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept empty edits array (runtime handles empty-check)', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits: [],
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept edits array with more than 20 items (no schema-level cap)', () => {
      const edits = Array.from({ length: 21 }, (_, i) => ({
        oldText: `old${i}`,
        newText: `new${i}`,
      }));

      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits,
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept single-element edits array', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      });

      expect(parsed.success).toBe(true);
    });

    it('should accept edits array alongside flat params (edits takes priority)', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        oldText: 'ignored',
        newText: 'ignored',
        edits: [{ oldText: 'old', newText: 'new' }],
      });

      expect(parsed.success).toBe(true);
    });

    it('should allow omitting oldText/newText when edits is provided', () => {
      const parsed = FilesApplyChangesToolSchema.safeParse({
        filePath: '/test/file.ts',
        edits: [{ oldText: 'old', newText: 'new' }],
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.oldText).toBeUndefined();
        expect(parsed.data.newText).toBeUndefined();
      }
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 'test-thread' },
    };

    function mockReadFile(content: string) {
      vi.spyOn(tool as any, 'readFileContent').mockResolvedValue({ content });
    }

    function mockWriteFile() {
      vi.spyOn(tool as any, 'writeFileContent').mockResolvedValue({});
    }

    function mockWriteFileError(error: string) {
      vi.spyOn(tool as any, 'writeFileContent').mockResolvedValue({ error });
    }

    describe('single-edit mode', () => {
      it('should replace text successfully', async () => {
        mockReadFile('line1\nline2\nline3');
        mockWriteFile();

        const { output } = await tool.invoke(
          { filePath: '/test/file.ts', oldText: 'line2', newText: 'modified' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.appliedEdits).toBe(1);
        expect(output.diff).toContain('-line2');
        expect(output.diff).toContain('+modified');
        expect(output.matchStage).toBe('exact');
      });

      it('should return error when oldText and newText are identical', async () => {
        const { output } = await tool.invoke(
          { filePath: '/test/file.ts', oldText: 'same', newText: 'same' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('identical');
      });

      it('should return error when both oldText and newText are missing', async () => {
        const { output } = await tool.invoke(
          { filePath: '/test/file.ts' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('edits array');
      });

      it('should return error when file not found', async () => {
        vi.spyOn(tool as any, 'readFileContent').mockResolvedValue({
          error: 'File not found: /test/file.ts',
        });

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'line2',
            newText: 'modified',
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('File not found');
      });

      it('should return error when no match found', async () => {
        mockReadFile('line1\nline2\nline3');

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'nonexistent',
            newText: 'modified',
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('Could not find match');
      });

      it('should succeed with simple edit', async () => {
        mockReadFile('line1\nline2\nline3');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'line2',
            newText: 'modified',
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
      });

      it('should return error when write fails', async () => {
        mockReadFile('line1\nline2\nline3');
        mockWriteFileError('Permission denied');

        const { output } = await tool.invoke(
          { filePath: '/test/file.ts', oldText: 'line2', newText: 'modified' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toBe('Permission denied');
      });

      it('should return error for empty oldText without insertAfterLine', async () => {
        const { output } = await tool.invoke(
          { filePath: '/test/file.ts', oldText: '', newText: 'new' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('Empty oldText');
      });

      it('should use replaceAll to replace multiple occurrences', async () => {
        mockReadFile('foo\nbar\nfoo');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'foo',
            newText: 'baz',
            replaceAll: true,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.appliedEdits).toBe(2);
      });

      it('should include postEditContext in successful result', async () => {
        mockReadFile('line1\nline2\nline3');
        mockWriteFile();

        const { output } = await tool.invoke(
          { filePath: '/test/file.ts', oldText: 'line2', newText: 'modified' },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.postEditContext).toBeDefined();
        expect(output.postEditContext).toContain('modified');
      });

      it('should warn when non-exact match stage is used', async () => {
        mockReadFile('    indented\n    code');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'indented\ncode',
            newText: 'new stuff',
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.matchStage).toBe('trimmed');
        expect(output.diff).toContain('trimmed match used');
      });
    });

    describe('insertAfterLine mode', () => {
      it('should insert text after specified line', async () => {
        mockReadFile('line1\nline2\nline3');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: '',
            newText: 'inserted',
            insertAfterLine: 1,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.appliedEdits).toBe(1);
        expect(output.diff).toContain('+inserted');
      });

      it('should insert at beginning of file with insertAfterLine 0', async () => {
        mockReadFile('line1\nline2');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: '',
            newText: 'header',
            insertAfterLine: 0,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.diff).toContain('+header');
      });

      it('should reject non-empty oldText with insertAfterLine', async () => {
        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: 'something',
            newText: 'inserted',
            insertAfterLine: 1,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('oldText must be an empty string');
      });

      it('should reject insertAfterLine beyond file length', async () => {
        mockReadFile('line1\nline2');

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: '',
            newText: 'inserted',
            insertAfterLine: 100,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('beyond the file length');
      });

      it('should succeed with simple insert', async () => {
        mockReadFile('line1\nline2');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: '',
            newText: 'inserted',
            insertAfterLine: 1,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
      });

      it('should return error when file read fails on insert', async () => {
        vi.spyOn(tool as any, 'readFileContent').mockResolvedValue({
          error: 'File not found',
        });

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            oldText: '',
            newText: 'inserted',
            insertAfterLine: 1,
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('File not found');
      });
    });

    describe('multi-edit mode', () => {
      it('should apply multiple edits atomically', async () => {
        mockReadFile('aaa\nbbb\nccc');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [
              { oldText: 'aaa', newText: 'AAA' },
              { oldText: 'ccc', newText: 'CCC' },
            ],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.appliedEdits).toBe(2);
        expect(output.totalEdits).toBe(2);
      });

      it('should reject no-op edit in multi-edit mode', async () => {
        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [
              { oldText: 'same', newText: 'same' },
              { oldText: 'bbb', newText: 'BBB' },
            ],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('identical');
        expect(output.failedEditIndex).toBe(0);
      });

      it('should reject empty oldText in multi-edit mode', async () => {
        mockReadFile('aaa\nbbb');

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [{ oldText: '', newText: 'new' }],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('empty oldText is not supported');
        expect(output.failedEditIndex).toBe(0);
      });

      it('should fail atomically when second edit has no match', async () => {
        mockReadFile('aaa\nbbb\nccc');

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [
              { oldText: 'aaa', newText: 'AAA' },
              { oldText: 'nonexistent', newText: 'XXX' },
            ],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(false);
        expect(output.error).toContain('Edit 1 failed');
        expect(output.failedEditIndex).toBe(1);
      });

      it('should apply sequential edits against evolving content', async () => {
        mockReadFile('foo\nbar');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [
              { oldText: 'foo', newText: 'baz' },
              { oldText: 'baz', newText: 'qux' },
            ],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.appliedEdits).toBe(2);
      });

      it('should succeed with simple multi-edit', async () => {
        mockReadFile('aaa\nbbb');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [{ oldText: 'aaa', newText: 'AAA' }],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
      });

      it('should report matchStages for non-exact matches', async () => {
        mockReadFile('    indented');
        mockWriteFile();

        const { output } = await tool.invoke(
          {
            filePath: '/test/file.ts',
            edits: [{ oldText: 'indented', newText: 'replaced' }],
          },
          mockConfig,
          mockCfg,
        );

        expect(output.success).toBe(true);
        expect(output.matchStages).toContain('trimmed');
      });
    });
  });
});
