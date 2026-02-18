import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import { shQuote } from '../../../../utils/shell.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const SingleEditSchema = z.object({
  oldText: z.string().describe('Exact text to find and replace.'),
  newText: z.string().describe('Replacement text.'),
  replaceAll: z
    .boolean()
    .nullable()
    .optional()
    .describe('If true, replaces all occurrences of oldText.'),
});

const FilesApplyChangesToolSchemaBase = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to edit. Must have been read with files_read first to get the current content for accurate oldText matching.',
    ),
  oldText: z
    .string()
    .nullable()
    .optional()
    .describe(
      'The exact text to find and replace, copied verbatim from files_read output (without line number prefixes). Must be non-empty for replacements. Use empty string ("") only with insertAfterLine to insert text at a specific line. Ignored when edits array is provided.',
    ),
  newText: z
    .string()
    .nullable()
    .optional()
    .describe(
      'The replacement text. Indentation is automatically adjusted to match the matched oldText block indentation. Ignored when edits array is provided.',
    ),
  replaceAll: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'If true, replaces all occurrences of oldText. If false or undefined, requires exactly one match. Ignored when edits array is provided.',
    ),
  edits: z
    .array(SingleEditSchema)
    .nullable()
    .optional()
    .describe(
      'Array of {oldText, newText, replaceAll?} pairs to apply atomically in order. When provided, the flat oldText/newText/replaceAll params are ignored. Each edit is applied against the result of the previous edit. If any edit fails, no changes are written.',
    ),
  insertAfterLine: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe(
      'Insert newText after this line number (0 = beginning of file). When used, oldText must be empty string.',
    ),
});

export const FilesApplyChangesToolSchema = FilesApplyChangesToolSchemaBase;

export type FilesApplyChangesToolSchemaType = z.input<
  typeof FilesApplyChangesToolSchema
>;

type EditMatch = {
  editIndex: number;
  startLine: number;
  endLine: number;
  matchedText: string;
  indentation: string;
};

type MatchStage = 'exact' | 'trimmed' | 'fuzzy';

type FilesApplyChangesToolOutput = {
  error?: string;
  success?: boolean;
  diff?: string;
  appliedEdits?: number;
  totalEdits?: number;
  matchStage?: MatchStage;
  matchStages?: MatchStage[];
  postEditContext?: string;
  failedEditIndex?: number;
};

const MAX_FUZZY_EDIT_RATIO = 0.15;
const MAX_FUZZY_OLD_TEXT_LINES = 50;
const MIN_FUZZY_LINE_LENGTH = 8;
const SIMILAR_BLOCK_PREFIX_LENGTH = 20;

@Injectable()
export class FilesApplyChangesTool extends FilesBaseTool<FilesApplyChangesToolSchemaType> {
  public name = 'files_apply_changes';
  public description =
    'Replace exact text blocks in an existing file, or insert text at a specific line. Supports multiple edits in one call via the edits array for atomic multi-region changes. Copy oldText verbatim from files_read output (without line number prefixes). To create new files, use files_write_file instead.';

  protected override generateTitle(
    args: FilesApplyChangesToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const name = basename(args.filePath);
    return `Editing ${name}`;
  }

  public get schema() {
    return FilesApplyChangesToolSchema;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Replace exact text blocks (oldText → newText). Primary edit tool — precise and fast.
      Supports multiple edits in one atomic call via the \`edits\` array.

      ### How to Use
      1. Run \`files_read\` first to get current content with line numbers
      2. Copy the EXACT text from the output into \`oldText\` — do NOT type from memory
      3. Include enough surrounding context (3-5 lines) to make the match unique
      4. Do NOT include line number prefixes (\`NNN\\t\`) in oldText — only the code itself

      ### Multi-Edit Mode
      Pass \`edits: [{oldText, newText, replaceAll?}, ...]\` to apply multiple replacements atomically in a single call. Each edit runs against the result of the previous one. If any edit fails, no changes are written.

      **Limitations:** Multi-edit mode only supports text replacements (non-empty \`oldText\`). It does not support \`insertAfterLine\`. Use a separate single-edit call for line insertions.

      **Example — Add import and use it:**
      \`\`\`json
      {
        "filePath": "${BASE_RUNTIME_WORKDIR}/project/src/app.ts",
        "edits": [
          {"oldText": "import { A } from './a';", "newText": "import { A } from './a';\\nimport { B } from './b';"},
          {"oldText": "const result = processA(data);", "newText": "const result = processA(processB(data));"}
        ]
      }
      \`\`\`

      ### Matching Strategy (Progressive Fallback)
      Three matching strategies are tried in order:
      1. **Exact**: whitespace-normalized comparison (trailing spaces stripped, blank-line runs collapsed)
      2. **Trimmed**: ignores all leading whitespace per line — catches wrong indentation
      3. **Fuzzy**: per-line Levenshtein distance ≤ 15% — catches minor typos, quote style differences
      - Must match exactly once unless \`replaceAll: true\` (fuzzy only accepts a single match)
      - Common indentation is auto-normalized; relative indentation within the block is preserved
      - Lines shorter than 8 characters require exact trimmed match (avoids false positives on \`}\`, \`return;\`, etc.)
      - Fuzzy matching is skipped for oldText blocks > 50 lines (performance safeguard)

      ### Insertion Mode
      Use \`insertAfterLine\` with empty \`oldText\` ("") to insert text at a specific position without replacing anything. Line 0 = beginning of file.

      ### Critical Rules
      - **NEVER pass the same text for oldText and newText** — the tool rejects identical values. Always verify your newText is DIFFERENT from oldText before calling.
      - **Prefer multi-edit mode** for multiple changes to the same file — use the \`edits\` array to apply all changes atomically in one call instead of making sequential single-edit calls.
      - After editing a file, the content changes. If you need to make another edit, either use the \`postEditContext\` from the response to copy accurate \`oldText\`, or call \`files_read\` again.

      ### Error Recovery
      - "oldText and newText are identical": you copied the same text into both fields — re-check what you actually want to change and provide DIFFERENT newText
      - "Found N matches": add more surrounding context lines or set \`replaceAll: true\`
      - "Could not find match": re-read the file with \`files_read\` and copy exact text from output
      - Use \`insertAfterLine\` with empty \`oldText\` for pure insertions (avoids matching entirely)

      ### CRITICAL: Never Retry the Same Failing Edit
      If an edit fails with "Could not find match":
      1. **STOP.** Do NOT retry with the same or similar oldText — the text you have is wrong.
      2. Run \`files_read\` on the file to see the ACTUAL current content.
      3. Copy the exact text from the fresh \`files_read\` output — character by character, including whitespace.
      4. If you already read the file once and the edit still fails, the file was likely modified by a previous edit. Run \`files_read\` AGAIN.
      5. **After 2 failed attempts on the same region**: use \`files_write_file\` to rewrite the entire file instead. This is faster than guessing at oldText.

      ### Examples
      **1. Simple text replacement:**
      \`\`\`json
      {"filePath": "${BASE_RUNTIME_WORKDIR}/project/src/app.ts", "oldText": "const port = 3000;", "newText": "const port = process.env.PORT || 3000;"}
      \`\`\`

      **2. Insert at beginning of file:**
      \`\`\`json
      {"filePath": "${BASE_RUNTIME_WORKDIR}/project/src/app.ts", "oldText": "", "insertAfterLine": 0, "newText": "import { config } from 'dotenv';\\nconfig();"}
      \`\`\`

      **3. Replace all occurrences:**
      \`\`\`json
      {"filePath": "${BASE_RUNTIME_WORKDIR}/project/src/utils.ts", "oldText": "console.log", "newText": "logger.info", "replaceAll": true}
      \`\`\`
    `;
  }

  private splitLines(text: string): string[] {
    return text.replace(/\r\n/g, '\n').split('\n');
  }

  private collapseBlankRuns(lines: string[]): string[] {
    const out: string[] = [];
    let prevBlank = false;

    for (const line of lines) {
      const isBlank = line.trim().length === 0;
      if (isBlank) {
        if (!prevBlank) out.push('');
        prevBlank = true;
      } else {
        out.push(line);
        prevBlank = false;
      }
    }

    return out;
  }

  private normalizeWhitespace(
    text: string,
    collapseBlankLines: boolean,
  ): string {
    const lines = this.splitLines(text)
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .map((line) => (line.trim().length === 0 ? '' : line));

    const stripped = this.stripCommonIndent(lines.join('\n')).split('\n');

    const finalLines = collapseBlankLines
      ? this.collapseBlankRuns(stripped)
      : stripped;

    return finalLines.join('\n').trim();
  }

  private stripSurroundingEmptyLines(text: string): string {
    const lines = this.splitLines(text);
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
      lines.pop();
    }
    while (lines.length > 0 && lines[0]?.trim() === '') {
      lines.shift();
    }
    return lines.join('\n');
  }

  private normalizeLineEndings(lines: string[]): string[] {
    return lines
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .map((l) => (l.trim().length === 0 ? '' : l));
  }

  private normalizeRawLines(text: string): string[] {
    return this.normalizeLineEndings(this.splitLines(text));
  }

  private detectIndentationFromBlock(text: string): string {
    const line = this.splitLines(text).find((l) => l.trim().length > 0);
    if (!line) return '';
    const match = line.match(/^(\s+)/);
    return match && match[1] ? match[1] : '';
  }

  private stripCommonIndent(text: string): string {
    const lines = this.splitLines(text);
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return lines.join('\n');
    const indents = nonEmpty.map((l) => l?.match(/^(\s*)/)?.[1]?.length ?? 0);
    const minIndent = Math.min(...indents);
    if (minIndent === 0) return lines.join('\n');
    return lines
      .map((l) => (l.trim().length ? l.slice(minIndent) : l))
      .join('\n');
  }

  private applyIndentation(text: string, indentation: string): string {
    const stripped = this.stripCommonIndent(text);
    if (!indentation) return stripped;
    const lines = this.splitLines(stripped);
    return lines
      .map((line) => {
        return line.trim() === '' ? line : indentation + line;
      })
      .join('\n');
  }

  private tryMatchAt(
    fileLinesRaw: string[],
    fileLinesOriginal: string[],
    startLine: number,
    oldLinesRaw: string[],
  ): { endLine: number; matchedText: string } | null {
    let i = startLine;
    let j = 0;

    while (j < oldLinesRaw.length) {
      if (oldLinesRaw[j] === '') {
        while (j < oldLinesRaw.length && oldLinesRaw[j] === '') j++;
        if (i >= fileLinesRaw.length || fileLinesRaw[i] !== '') return null;
        while (i < fileLinesRaw.length && fileLinesRaw[i] === '') i++;
        continue;
      }

      if (i >= fileLinesRaw.length) return null;
      if (fileLinesRaw[i] !== oldLinesRaw[j]) return null;

      i++;
      j++;
    }

    const endLine = Math.max(startLine, i - 1);
    const matchedText = fileLinesOriginal.slice(startLine, i).join('\n');

    return { endLine, matchedText };
  }

  /**
   * Stage 2: Trimmed matching — ignores all leading whitespace, compares content only.
   * Catches the most common LLM error: wrong indentation.
   */
  private tryMatchAtTrimmed(
    fileLinesOriginal: string[],
    startLine: number,
    oldLinesTrimmed: string[],
  ): { endLine: number; matchedText: string } | null {
    if (startLine + oldLinesTrimmed.length > fileLinesOriginal.length) {
      return null;
    }

    for (let j = 0; j < oldLinesTrimmed.length; j++) {
      const fileLine = fileLinesOriginal[startLine + j];
      if (fileLine === undefined) return null;
      const fileLineTrimmed = fileLine.trim();
      const oldLineTrimmed = oldLinesTrimmed[j]!;

      // Both blank → match
      if (fileLineTrimmed === '' && oldLineTrimmed === '') continue;
      if (fileLineTrimmed !== oldLineTrimmed) return null;
    }

    const endLine = startLine + oldLinesTrimmed.length - 1;
    const matchedText = fileLinesOriginal
      .slice(startLine, endLine + 1)
      .join('\n');
    return { endLine, matchedText };
  }

  /**
   * Simple Levenshtein distance for short strings.
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Use two rows instead of full matrix for memory efficiency
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array<number>(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          (curr[j - 1] ?? 0) + 1,
          (prev[j] ?? 0) + 1,
          (prev[j - 1] ?? 0) + cost,
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[b.length] ?? 0;
  }

  /**
   * Stage 3: Fuzzy matching — per-line Levenshtein distance with ≤15% threshold.
   * Catches minor typos, quote style differences, trailing semicolons.
   */
  private tryMatchAtFuzzy(
    fileLinesOriginal: string[],
    startLine: number,
    oldLinesTrimmed: string[],
    maxEditRatio: number,
  ): { endLine: number; matchedText: string } | null {
    if (startLine + oldLinesTrimmed.length > fileLinesOriginal.length) {
      return null;
    }

    for (let j = 0; j < oldLinesTrimmed.length; j++) {
      const fileLine = fileLinesOriginal[startLine + j];
      if (fileLine === undefined) return null;
      const fileLineTrimmed = fileLine.trim();
      const oldLineTrimmed = oldLinesTrimmed[j]!;

      // Both blank → match
      if (fileLineTrimmed === '' && oldLineTrimmed === '') continue;

      const maxLen = Math.max(fileLineTrimmed.length, oldLineTrimmed.length);
      if (maxLen === 0) continue;

      // Short lines (e.g. "}", "return;") require exact trimmed match to avoid false positives
      if (maxLen < MIN_FUZZY_LINE_LENGTH) {
        if (fileLineTrimmed !== oldLineTrimmed) return null;
        continue;
      }

      // Skip Levenshtein for very long lines (expensive) — fall back to trimmed comparison
      if (maxLen > 500) {
        if (fileLineTrimmed !== oldLineTrimmed) return null;
        continue;
      }

      const dist = this.levenshteinDistance(fileLineTrimmed, oldLineTrimmed);
      if (dist / maxLen > maxEditRatio) return null;
    }

    const endLine = startLine + oldLinesTrimmed.length - 1;
    const matchedText = fileLinesOriginal
      .slice(startLine, endLine + 1)
      .join('\n');
    return { endLine, matchedText };
  }

  /**
   * Find matches using trimmed comparison (Stage 2).
   */
  private findMatchesTrimmed(
    originalLines: string[],
    oldText: string,
    replaceAll: boolean,
  ): { matches: EditMatch[]; errors: string[] } {
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    const oldLinesTrimmed = this.splitLines(oldText).map((l) => l.trim());

    for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex++) {
      const candidate = this.tryMatchAtTrimmed(
        originalLines,
        lineIndex,
        oldLinesTrimmed,
      );
      if (!candidate) continue;

      const indentation = this.detectIndentationFromBlock(
        candidate.matchedText,
      );
      matches.push({
        editIndex: 0,
        startLine: lineIndex,
        endLine: candidate.endLine,
        matchedText: candidate.matchedText,
        indentation,
      });

      // Skip past matched region to avoid overlapping matches
      lineIndex = candidate.endLine;
    }

    if (matches.length > 1 && !replaceAll) {
      const matchLocations = matches
        .map((m) => `lines ${m.startLine + 1}-${m.endLine + 1}`)
        .join(', ');
      errors.push(
        `Found ${matches.length} trimmed matches at ${matchLocations}. Add more context or set replaceAll to true.`,
      );
      return { matches: [], errors };
    }

    return { matches, errors };
  }

  /**
   * Find matches using fuzzy comparison (Stage 3).
   * Only accepts single match to avoid ambiguity.
   * Skips fuzzy matching for large oldText (>50 lines) to avoid O(n*m*L^2) cost.
   */
  private findMatchesFuzzy(
    originalLines: string[],
    oldText: string,
  ): { matches: EditMatch[]; errors: string[] } {
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    const oldLinesTrimmed = this.splitLines(oldText).map((l) => l.trim());

    // Skip fuzzy matching for large oldText to avoid expensive Levenshtein per-line cost
    if (oldLinesTrimmed.length > MAX_FUZZY_OLD_TEXT_LINES) {
      return { matches, errors };
    }

    for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex++) {
      const candidate = this.tryMatchAtFuzzy(
        originalLines,
        lineIndex,
        oldLinesTrimmed,
        MAX_FUZZY_EDIT_RATIO,
      );
      if (!candidate) continue;

      const indentation = this.detectIndentationFromBlock(
        candidate.matchedText,
      );
      matches.push({
        editIndex: 0,
        startLine: lineIndex,
        endLine: candidate.endLine,
        matchedText: candidate.matchedText,
        indentation,
      });

      // Skip past matched region to avoid overlapping matches
      lineIndex = candidate.endLine;
    }

    // Fuzzy matching only accepts exactly 1 match to avoid false positives
    if (matches.length > 1) {
      errors.push(
        'Fuzzy matching found multiple candidates — too ambiguous. Add more context lines to oldText.',
      );
      return { matches: [], errors };
    }

    return { matches, errors };
  }

  /**
   * Progressive matching pipeline: exact -> trimmed -> fuzzy.
   * Returns the first stage that succeeds.
   * File content is normalized once and shared across all stages.
   */
  private findMatchesProgressive(
    fileContent: string,
    oldText: string,
    replaceAll: boolean,
  ): { matches: EditMatch[]; errors: string[]; matchStage?: MatchStage } {
    // Strip leading/trailing empty lines from oldText — LLMs frequently include
    // a trailing \n which produces a phantom blank line that breaks all match stages
    const trimmedOldText = this.stripSurroundingEmptyLines(oldText);

    // Split once, share across all stages
    const originalLines = this.splitLines(fileContent);

    // Stage 1: Exact (whitespace-normalized)
    const stage1 = this.findMatches(originalLines, trimmedOldText, replaceAll);
    if (stage1.matches.length > 0) {
      return { ...stage1, matchStage: 'exact' };
    }

    // Only try fallback stages if stage 1 found zero matches (not ambiguous)
    const hasZeroMatches = stage1.errors.some((e) =>
      e.includes('Could not find match'),
    );
    if (!hasZeroMatches) {
      return stage1; // Ambiguous match error — don't try fuzzier stages
    }

    // Stage 2: Trimmed (ignore leading whitespace)
    const stage2 = this.findMatchesTrimmed(
      originalLines,
      trimmedOldText,
      replaceAll,
    );
    if (stage2.matches.length > 0) {
      return { ...stage2, matchStage: 'trimmed' };
    }

    // Stage 3: Fuzzy (Levenshtein ≤15%)
    // Only for single match (replaceAll not supported for fuzzy)
    if (!replaceAll) {
      const stage3 = this.findMatchesFuzzy(originalLines, trimmedOldText);
      if (stage3.matches.length > 0) {
        return { ...stage3, matchStage: 'fuzzy' };
      }
    }

    // All stages failed — return stage 1 errors (most helpful, has similar blocks)
    return stage1;
  }

  /**
   * Compare oldText and a similar block line-by-line and return human-readable
   * hints about which lines differ and how. Helps the LLM understand WHY a
   * match failed instead of forcing it to visually diff two code blocks.
   */
  private generateMismatchHints(
    oldText: string,
    candidateText: string,
    maxHints = 5,
  ): string {
    const oldLines = this.splitLines(oldText);
    const candidateLines = this.splitLines(candidateText);
    const hints: string[] = [];

    const maxLen = Math.min(oldLines.length, candidateLines.length);
    for (let i = 0; i < maxLen && hints.length < maxHints; i++) {
      const oldLine = oldLines[i]!.trim();
      const candLine = candidateLines[i]!.trim();

      if (oldLine === candLine) continue;

      // Truncate long lines for readability
      const truncate = (s: string, max = 80): string =>
        s.length > max ? s.substring(0, max) + '…' : s;

      hints.push(
        `  Line ${i + 1}: yours has "${truncate(oldLine)}" but file has "${truncate(candLine)}"`,
      );
    }

    if (oldLines.length !== candidateLines.length) {
      hints.push(
        `  Line count: yours has ${oldLines.length} lines but file has ${candidateLines.length} lines`,
      );
    }

    return hints.length > 0 ? `Differences found:\n${hints.join('\n')}` : '';
  }

  private findSimilarBlocks(
    originalLines: string[],
    oldText: string,
    maxResults = 3,
  ): { lineStart: number; lineEnd: number; text: string }[] {
    const oldLines = this.splitLines(oldText).filter(
      (l) => l.trim().length > 0,
    );

    if (oldLines.length === 0) return [];

    const firstOldLineNormalized = oldLines[0]
      ?.trim()
      .toLowerCase()
      .substring(0, 50);
    if (!firstOldLineNormalized) return [];

    const candidates: {
      lineStart: number;
      lineEnd: number;
      text: string;
    }[] = [];

    for (let i = 0; i < originalLines.length; i++) {
      const lineNormalized = originalLines[i]
        ?.trim()
        .toLowerCase()
        .substring(0, 50);
      if (
        lineNormalized?.includes(
          firstOldLineNormalized.substring(0, SIMILAR_BLOCK_PREFIX_LENGTH),
        )
      ) {
        const endLine = Math.min(i + oldLines.length + 2, originalLines.length);
        const blockText = originalLines.slice(i, endLine).join('\n');
        candidates.push({
          lineStart: i,
          lineEnd: endLine - 1,
          text: blockText,
        });
      }
    }

    return candidates.slice(0, maxResults);
  }

  private findMatches(
    originalLines: string[],
    oldText: string,
    replaceAll: boolean,
  ): { matches: EditMatch[]; errors: string[] } {
    const fileLinesRaw = this.normalizeLineEndings(originalLines);

    const matches: EditMatch[] = [];
    const errors: string[] = [];

    if (oldText === '') {
      return { matches, errors };
    }

    const oldLinesRaw = this.normalizeRawLines(oldText);

    const normalizedOldText = this.normalizeWhitespace(oldText, true);

    const foundMatches: EditMatch[] = [];

    for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex++) {
      const candidate = this.tryMatchAt(
        fileLinesRaw,
        originalLines,
        lineIndex,
        oldLinesRaw,
      );
      if (!candidate) continue;

      const normalizedCandidate = this.normalizeWhitespace(
        candidate.matchedText,
        true,
      );

      if (normalizedCandidate === normalizedOldText) {
        const indentation = this.detectIndentationFromBlock(
          candidate.matchedText,
        );
        foundMatches.push({
          editIndex: 0,
          startLine: lineIndex,
          endLine: candidate.endLine,
          matchedText: candidate.matchedText,
          indentation,
        });
      }
    }

    if (foundMatches.length === 0) {
      const normalizedOld = this.normalizeWhitespace(oldText, true);
      const previewLines = normalizedOld.split('\n').slice(0, 3);
      const preview =
        previewLines.length < normalizedOld.split('\n').length
          ? `${previewLines.join('\n')}...`
          : normalizedOld;

      const similarBlocks = this.findSimilarBlocks(originalLines, oldText, 2);
      let similarContext = '';
      let readSuggestion = '';
      if (similarBlocks.length > 0) {
        const closestBlock = similarBlocks[0]!;

        // Generate per-line diff hints for the closest match
        const mismatchHints = this.generateMismatchHints(
          oldText,
          closestBlock.text,
        );

        similarContext = dedent`

          Closest similar block found at lines ${closestBlock.lineStart + 1}-${closestBlock.lineEnd + 1} (NOT an exact match):
          ${closestBlock.text.split('\n').slice(0, 5).join('\n')}${closestBlock.text.split('\n').length > 5 ? '\n...' : ''}

          ${mismatchHints}
        `;

        if (similarBlocks.length > 1) {
          const other = similarBlocks[1]!;
          similarContext += `\n\nAnother similar block at lines ${other.lineStart + 1}-${other.lineEnd + 1}.`;
        }

        // Suggest a targeted files_read line range instead of re-reading the whole file
        const suggestedStart = Math.max(1, closestBlock.lineStart - 5);
        const suggestedEnd = closestBlock.lineEnd + 20;
        readSuggestion = `\nTIP: Run files_read with fromLineNumber=${suggestedStart} and toLineNumber=${suggestedEnd} to see the actual content around the closest match.`;
      }

      errors.push(
        dedent`
          Could not find match for oldText in file.

          Searched for (normalized):
          "${preview}"
          ${similarContext}

          REQUIRED ACTION:
          1. Run files_read on this file to see current content
          2. Copy the EXACT text from the output (including whitespace)
          3. Do NOT type from memory or guess
          4. Compare the "Searched for" text above with actual file content
          ${readSuggestion}

          Common mistakes:
          - Wrong indentation or spaces
          - Different quote styles (" vs ')
          - Missing or extra newlines
          - File was modified since last read

          WARNING: Do NOT retry with the same oldText — it will fail again.
          If this is your 2nd+ failure on this file, use files_write_file to rewrite the entire file instead.
        `,
      );
    } else if (foundMatches.length > 1 && !replaceAll) {
      const matchLocations = foundMatches
        .map((m) => `lines ${m.startLine + 1}-${m.endLine + 1}`)
        .join(', ');
      errors.push(
        `Found ${foundMatches.length} matches for oldText at ${matchLocations}. TIP: Set replaceAll to true to replace all occurrences, or add MORE surrounding context (5-10 lines before/after) to make the match unique. Include nearby unique elements like function names, imports, or comments.`,
      );
    } else {
      matches.push(...foundMatches);
    }

    return { matches, errors };
  }

  private generateDiff(
    originalLines: string[],
    matches: EditMatch[],
    newText: string,
  ): string {
    const diffParts: string[] = [];

    for (const match of matches) {
      const contextBefore = 5;
      const contextAfter = 5;

      const startContext = Math.max(0, match.startLine - contextBefore);
      const endContext = Math.min(
        originalLines.length - 1,
        match.endLine + contextAfter,
      );

      const newTextLines = newText.split('\n').length;
      diffParts.push(
        `@@ -${match.startLine + 1},${match.endLine - match.startLine + 1} +${match.startLine + 1},${newTextLines} @@`,
      );

      for (let i = startContext; i < match.startLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }

      for (let i = match.startLine; i <= match.endLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(`-${line}`);
        }
      }

      const newTextWithIndent = this.applyIndentation(
        newText,
        match.indentation,
      );
      for (const line of newTextWithIndent.split('\n')) {
        diffParts.push(`+${line}`);
      }

      for (let i = match.endLine + 1; i <= endContext; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }
    }

    return diffParts.join('\n');
  }

  private applyEdits(
    fileContent: string,
    matches: EditMatch[],
    newText: string,
  ): string {
    const lines = this.splitLines(fileContent);

    const sortedMatches = [...matches].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const match of sortedMatches) {
      const newTextWithIndent = this.applyIndentation(
        newText,
        match.indentation,
      );
      const newLines = newTextWithIndent.split('\n');

      lines.splice(
        match.startLine,
        match.endLine - match.startLine + 1,
        ...newLines,
      );
    }

    return lines.join('\n');
  }

  private async readFileContent(
    filePath: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<{ content: string } | { error: string }> {
    const p = shQuote(filePath);
    const res = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);
    if (res.exitCode !== 0) {
      const stderr = res.stderr || '';
      if (stderr.includes('No such file or directory')) {
        return {
          error: `File not found: ${filePath}. To create a new file, use files_write_file instead.`,
        };
      }
      return { error: stderr || 'Failed to read file' };
    }
    return { content: res.stdout };
  }

  public async invoke(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // Multi-edit mode: apply an array of edits atomically
    if (args.edits && args.edits.length > 0) {
      return this.invokeMultiEdit(args, config, cfg, messageMetadata);
    }

    // Single-edit mode: require oldText and newText
    if (args.oldText == null || args.newText == null) {
      const received = {
        oldText:
          args.oldText === null
            ? 'null'
            : args.oldText === undefined
              ? 'missing'
              : 'present',
        newText:
          args.newText === null
            ? 'null'
            : args.newText === undefined
              ? 'missing'
              : 'present',
        edits:
          args.edits === null
            ? 'null'
            : args.edits === undefined
              ? 'missing'
              : 'present',
      };
      return {
        output: {
          success: false,
          error: dedent`
            Either provide edits array or both oldText and newText parameters.

            Received: oldText=${received.oldText}, newText=${received.newText}, edits=${received.edits}

            Two valid modes:
            1. Single edit: {"filePath": "...", "oldText": "exact text", "newText": "replacement text"}
            2. Multi edit:  {"filePath": "...", "edits": [{"oldText": "...", "newText": "..."}]}

            Common mistake: passing null instead of a string for oldText/newText.
          `,
        },
        messageMetadata,
      };
    }

    // Detect no-op calls early (oldText === newText)
    if (args.oldText !== '' && args.oldText === args.newText) {
      return {
        output: {
          success: false,
          error:
            'oldText and newText are identical — no changes would be made. You must provide DIFFERENT text in newText. Re-read the file with files_read, identify the exact text you want to change, then call files_apply_changes with the correct oldText (current code) and newText (desired code). Do NOT copy the same text into both fields.',
        },
        messageMetadata,
      };
    }

    // Handle insertAfterLine mode
    if (args.insertAfterLine !== undefined) {
      return this.invokeInsertAfterLine(args, config, cfg, messageMetadata);
    }

    if (args.oldText === '') {
      return {
        output: {
          success: false,
          error:
            'Empty oldText without insertAfterLine is not supported. To create or overwrite a file, use files_write_file. To insert text at a specific line, provide insertAfterLine.',
        },
        messageMetadata,
      };
    }

    const readRes = await this.readFileContent(args.filePath, config, cfg);
    if ('error' in readRes) {
      return {
        output: { success: false, error: readRes.error },
        messageMetadata,
      };
    }

    const fileContent = readRes.content;

    const { matches, errors, matchStage } = this.findMatchesProgressive(
      fileContent,
      args.oldText,
      args.replaceAll ?? false,
    );

    if (errors.length > 0) {
      let errorMsg = errors.join(' ');

      // Suggest insertAfterLine when the edit looks like an insertion attempt
      // (newText contains oldText as a substring, suggesting the LLM is wrapping
      // existing code with additions rather than replacing it)
      if (
        args.oldText.trim().length > 0 &&
        args.newText.includes(args.oldText.trim())
      ) {
        errorMsg +=
          '\n\nTIP: Your newText appears to contain your oldText plus additional code. Consider using insertAfterLine mode instead — set oldText to "" and insertAfterLine to the line number where you want to insert new code.';
      }

      return {
        output: {
          success: false,
          error: errorMsg,
        },
        messageMetadata,
      };
    }

    const originalLines = this.splitLines(fileContent);
    const diff = this.generateDiff(originalLines, matches, args.newText);

    const modifiedContent = this.applyEdits(fileContent, matches, args.newText);

    const writeRes = await this.writeFileContent(
      args.filePath,
      modifiedContent,
      config,
      cfg,
    );
    if (writeRes.error) {
      return {
        output: { success: false, error: writeRes.error },
        messageMetadata,
      };
    }

    // Generate post-edit context with line numbers
    const modifiedLines = this.splitLines(modifiedContent);
    const firstMatch = matches[0];
    const lastMatch = matches[matches.length - 1];
    let postEditContext: string | undefined;
    if (firstMatch && lastMatch) {
      const contextStart = Math.max(0, firstMatch.startLine - 5);
      const newTextLineCount = args.newText.split('\n').length;
      const oldTextLineCount = lastMatch.endLine - firstMatch.startLine + 1;
      const lineDelta = newTextLineCount - oldTextLineCount;
      const contextEnd = Math.min(
        modifiedLines.length,
        lastMatch.endLine + lineDelta + 6,
      );
      postEditContext = modifiedLines
        .slice(contextStart, contextEnd)
        .map((line, i) => `${contextStart + i + 1}\t${line}`)
        .join('\n');
    }

    const matchWarning =
      matchStage && matchStage !== 'exact'
        ? ` (${matchStage} match used — verify diff carefully)`
        : '';

    return {
      output: {
        success: true,
        appliedEdits: matches.length,
        totalEdits: 1,
        diff: diff + matchWarning,
        matchStage,
        postEditContext,
      },
      messageMetadata,
    };
  }

  private async invokeInsertAfterLine(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    messageMetadata: { __title: string | undefined },
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    if (args.oldText !== '') {
      return {
        output: {
          success: false,
          error: 'When using insertAfterLine, oldText must be an empty string.',
        },
        messageMetadata,
      };
    }

    const readRes = await this.readFileContent(args.filePath, config, cfg);
    if ('error' in readRes) {
      return {
        output: { success: false, error: readRes.error },
        messageMetadata,
      };
    }

    const lines = this.splitLines(readRes.content);
    const insertLine = args.insertAfterLine!;

    if (insertLine > lines.length) {
      return {
        output: {
          success: false,
          error: `insertAfterLine ${insertLine} is beyond the file length (${lines.length} lines).`,
        },
        messageMetadata,
      };
    }

    const newLines = this.splitLines(args.newText!);
    lines.splice(insertLine, 0, ...newLines);

    const modifiedContent = lines.join('\n');
    const writeRes = await this.writeFileContent(
      args.filePath,
      modifiedContent,
      config,
      cfg,
    );
    if (writeRes.error) {
      return {
        output: { success: false, error: writeRes.error },
        messageMetadata,
      };
    }

    // Generate diff for insertion
    const diffParts: string[] = [];
    const diffContextStart = Math.max(0, insertLine - 5);
    diffParts.push(
      `@@ -${insertLine + 1},0 +${insertLine + 1},${newLines.length} @@`,
    );
    for (let i = diffContextStart; i < insertLine && i < lines.length; i++) {
      diffParts.push(` ${lines[i]}`);
    }
    for (const nl of newLines) {
      diffParts.push(`+${nl}`);
    }
    const diffContextEnd = Math.min(
      lines.length,
      insertLine + newLines.length + 5,
    );
    for (let i = insertLine + newLines.length; i < diffContextEnd; i++) {
      if (lines[i] !== undefined) {
        diffParts.push(` ${lines[i]}`);
      }
    }
    const diff = diffParts.join('\n');

    // Generate post-edit context
    const contextStart = Math.max(0, insertLine - 5);
    const contextEnd = Math.min(lines.length, insertLine + newLines.length + 5);
    const postEditContext = lines
      .slice(contextStart, contextEnd)
      .map((line, i) => `${contextStart + i + 1}\t${line}`)
      .join('\n');

    return {
      output: {
        success: true,
        appliedEdits: 1,
        totalEdits: 1,
        diff,
        postEditContext,
      },
      messageMetadata,
    };
  }

  private async invokeMultiEdit(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    messageMetadata: { __title: string | undefined },
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    const edits = args.edits!;

    // Validate no-op edits early
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;
      if (edit.oldText !== '' && edit.oldText === edit.newText) {
        return {
          output: {
            success: false,
            error: `Edit ${i}: oldText and newText are identical — no changes would be made. Provide DIFFERENT text in newText. Remove this no-op edit from the edits array and retry with only the edits that actually change code.`,
            failedEditIndex: i,
          },
          messageMetadata,
        };
      }
    }

    const readRes = await this.readFileContent(args.filePath, config, cfg);
    if ('error' in readRes) {
      return {
        output: { success: false, error: readRes.error },
        messageMetadata,
      };
    }

    const originalContent = readRes.content;

    // Apply each edit sequentially against evolving content
    let currentContent = originalContent;
    const allDiffParts: string[] = [];
    const matchStages: MatchStage[] = [];

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!;

      if (edit.oldText === '') {
        return {
          output: {
            success: false,
            error: `Edit ${i}: empty oldText is not supported in multi-edit mode. Use insertAfterLine for insertions or files_write_file for new files.`,
            failedEditIndex: i,
          },
          messageMetadata,
        };
      }

      const { matches, errors, matchStage } = this.findMatchesProgressive(
        currentContent,
        edit.oldText,
        edit.replaceAll ?? false,
      );

      if (errors.length > 0) {
        const progressNote =
          i > 0
            ? ` ${i} of ${edits.length} edits matched successfully before this failure.`
            : '';
        return {
          output: {
            success: false,
            error: `Edit ${i} failed: ${errors.join(' ')}${progressNote} The file was NOT modified (atomic mode). Fix edit ${i} and retry all edits, or split into separate single-edit calls.`,
            failedEditIndex: i,
            appliedEdits: i,
            totalEdits: edits.length,
          },
          messageMetadata,
        };
      }

      if (matchStage) {
        matchStages.push(matchStage);
      }

      // Generate diff for this edit
      const currentLines = this.splitLines(currentContent);
      const editDiff = this.generateDiff(currentLines, matches, edit.newText);
      if (editDiff) {
        allDiffParts.push(editDiff);
      }

      // Apply edit to get new content for next iteration
      currentContent = this.applyEdits(currentContent, matches, edit.newText);
    }

    // All edits matched successfully — write the final result
    const writeRes = await this.writeFileContent(
      args.filePath,
      currentContent,
      config,
      cfg,
    );
    if (writeRes.error) {
      return {
        output: { success: false, error: writeRes.error },
        messageMetadata,
      };
    }

    // Generate post-edit context from the final modified content
    const modifiedLines = this.splitLines(currentContent);
    const lastEdit = edits[edits.length - 1];
    let postEditContext: string | undefined;
    if (lastEdit) {
      // Show context around the last edit's approximate location
      const lastEditLines = this.splitLines(lastEdit.oldText);
      // Find where the last edit landed in the final content
      const lastEditNewLines = this.splitLines(lastEdit.newText);
      // Use a simple heuristic: search for the newText in the final content
      const searchSnippet = lastEditNewLines[0]?.trim();
      let approxLine = modifiedLines.length - 1;
      if (searchSnippet) {
        for (let i = modifiedLines.length - 1; i >= 0; i--) {
          if (modifiedLines[i]?.trim().includes(searchSnippet)) {
            approxLine = i;
            break;
          }
        }
      }
      const contextStart = Math.max(0, approxLine - lastEditLines.length - 5);
      const contextEnd = Math.min(
        modifiedLines.length,
        approxLine + lastEditNewLines.length + 5,
      );
      postEditContext = modifiedLines
        .slice(contextStart, contextEnd)
        .map((line, i) => `${contextStart + i + 1}\t${line}`)
        .join('\n');
    }

    const nonExactStages = matchStages.filter((s) => s !== 'exact');
    const matchWarning =
      nonExactStages.length > 0
        ? ` (non-exact matches used: ${nonExactStages.join(', ')} — verify diff carefully)`
        : '';

    return {
      output: {
        success: true,
        appliedEdits: edits.length,
        totalEdits: edits.length,
        diff: allDiffParts.join('\n') + matchWarning,
        matchStages,
        postEditContext,
      },
      messageMetadata,
    };
  }
}
