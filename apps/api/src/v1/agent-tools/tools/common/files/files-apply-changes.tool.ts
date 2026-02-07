import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const FilesApplyChangesToolSchemaBase = z.object({
  filePath: z.string().min(1).describe('Absolute path to the file to edit'),
  oldText: z
    .string()
    .describe(
      'Text block to search for (copied verbatim from files_read output, without line number prefixes). Empty string means create/overwrite file.',
    ),
  newText: z
    .string()
    .describe('Text to replace with. Indentation will be preserved.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'If true, replaces all occurrences of oldText. If false or undefined, requires exactly one match.',
    ),
  insertAfterLine: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Insert newText after this line number (0 = beginning of file). When used, oldText must be empty string.',
    ),
  expectedHash: z
    .string()
    .optional()
    .describe(
      'Content hash from files_read output. If provided and file has changed since read, edit is rejected with an error.',
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
  postEditContext?: string;
};

const MAX_FUZZY_EDIT_RATIO = 0.15;
const MAX_FUZZY_OLD_TEXT_LINES = 50;

@Injectable()
export class FilesApplyChangesTool extends FilesBaseTool<FilesApplyChangesToolSchemaType> {
  public name = 'files_apply_changes';
  public description =
    'Replace exact text blocks in a file. Requires oldText copied verbatim from files_read. Use for precise edits or find/replace with replaceAll.';

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
      Replace exact text blocks (oldText -> newText). Primary edit tool — precise and fast.

      ### How to Use
      1. Run \`files_read\` first to get current content with line numbers
      2. Copy the EXACT text from the output into \`oldText\` — do NOT type from memory
      3. Include enough surrounding context (3-5 lines) to make the match unique
      4. Do NOT include line number prefixes (\`NNN\\t\`) in oldText — only the code itself

      ### Matching
      - Whitespace-normalized matching with progressive fallback (exact -> trimmed -> fuzzy)
      - Must match exactly once unless \`replaceAll: true\`
      - Common indentation is auto-normalized; relative indentation is preserved

      ### Error Recovery
      - "Found N matches": add more context lines or set \`replaceAll: true\`
      - "Could not find match": re-read the file and copy exact text from output
      - Use \`insertAfterLine\` with empty \`oldText\` for pure insertions (avoids matching)
    `;
  }

  private shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
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
    const normalized = text.replace(/\r\n/g, '\n');

    const lines = normalized
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .map((line) => (line.trim().length === 0 ? '' : line));

    const stripped = this.stripCommonIndent(lines.join('\n')).split('\n');

    const finalLines = collapseBlankLines
      ? this.collapseBlankRuns(stripped)
      : stripped;

    return finalLines.join('\n').trim();
  }

  private normalizeRawLines(text: string): string[] {
    return text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .map((l) => (l.trim().length === 0 ? '' : l));
  }

  private detectIndentationFromBlock(text: string): string {
    const line = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .find((l) => l.trim().length > 0);
    if (!line) return '';
    const match = line.match(/^(\s+)/);
    return match && match[1] ? match[1] : '';
  }

  private stripCommonIndent(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
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
    const stripped = this.stripCommonIndent(text).replace(/\r\n/g, '\n');
    if (!indentation) return stripped;
    const lines = stripped.split('\n');
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

    const oldLinesTrimmed = oldText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim());

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

    const oldLinesTrimmed = oldText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim());

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
    // Stage 1: Exact (whitespace-normalized)
    const stage1 = this.findMatches(fileContent, oldText, replaceAll);
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

    // Normalize once for stages 2 & 3
    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');

    // Stage 2: Trimmed (ignore leading whitespace)
    const stage2 = this.findMatchesTrimmed(originalLines, oldText, replaceAll);
    if (stage2.matches.length > 0) {
      return { ...stage2, matchStage: 'trimmed' };
    }

    // Stage 3: Fuzzy (Levenshtein ≤15%)
    // Only for single match (replaceAll not supported for fuzzy)
    if (!replaceAll) {
      const stage3 = this.findMatchesFuzzy(originalLines, oldText);
      if (stage3.matches.length > 0) {
        return { ...stage3, matchStage: 'fuzzy' };
      }
    }

    // All stages failed — return stage 1 errors (most helpful, has similar blocks)
    return stage1;
  }

  private findSimilarBlocks(
    fileContent: string,
    oldText: string,
    maxResults = 3,
  ): { lineStart: number; lineEnd: number; text: string }[] {
    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const oldLines = oldText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.trim().length > 0);

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
      if (lineNormalized?.includes(firstOldLineNormalized.substring(0, 20))) {
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
    fileContent: string,
    oldText: string,
    replaceAll: boolean,
  ): { matches: EditMatch[]; errors: string[] } {
    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const fileLinesRaw = originalLines
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .map((l) => (l.trim().length === 0 ? '' : l));

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

      const similarBlocks = this.findSimilarBlocks(fileContent, oldText, 2);
      let similarContext = '';
      if (similarBlocks.length > 0) {
        similarContext = dedent`

          Possible similar blocks found in the file (these are NOT exact matches):
          ${similarBlocks
            .map(
              (b) =>
                `Lines ${b.lineStart + 1}-${b.lineEnd + 1}:\n${b.text.split('\n').slice(0, 5).join('\n')}${b.text.split('\n').length > 5 ? '\n...' : ''}`,
            )
            .join('\n\n')}

          Compare these with what you were searching for to see the differences.
        `;
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

          Common mistakes:
          - Wrong indentation or spaces
          - Different quote styles (" vs ')
          - Missing or extra newlines
          - File was modified since last read
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
    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');

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

  public async invoke(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // Detect no-op calls early (oldText === newText)
    if (args.oldText !== '' && args.oldText === args.newText) {
      return {
        output: {
          success: false,
          error:
            'oldText and newText are identical - no changes would be made. This is a no-op.',
        },
        messageMetadata,
      };
    }

    // Handle insertAfterLine mode
    if (args.insertAfterLine !== undefined) {
      if (args.oldText !== '') {
        return {
          output: {
            success: false,
            error:
              'When using insertAfterLine, oldText must be an empty string.',
          },
          messageMetadata,
        };
      }

      const p = this.shQuote(args.filePath);
      const readResult = await this.execCommand(
        { cmd: `cat ${p}` },
        config,
        cfg,
      );

      if (readResult.exitCode !== 0) {
        return {
          output: {
            success: false,
            error: readResult.stderr || 'Failed to read file',
          },
          messageMetadata,
        };
      }

      const fileContent = readResult.stdout;
      const lines = fileContent.replace(/\r\n/g, '\n').split('\n');
      const insertLine = args.insertAfterLine;

      if (insertLine > lines.length) {
        return {
          output: {
            success: false,
            error: `insertAfterLine ${insertLine} is beyond the file length (${lines.length} lines).`,
          },
          messageMetadata,
        };
      }

      const newLines = args.newText.replace(/\r\n/g, '\n').split('\n');
      lines.splice(insertLine, 0, ...newLines);

      const modifiedContent = lines.join('\n');
      const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
        'base64',
      );
      const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
      const cmd = `printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

      const writeResult = await this.execCommand({ cmd }, config, cfg);
      if (writeResult.exitCode !== 0) {
        return {
          output: {
            success: false,
            error: writeResult.stderr || 'Failed to write file',
          },
          messageMetadata,
        };
      }

      // Generate post-edit context
      const contextStart = Math.max(0, insertLine - 5);
      const contextEnd = Math.min(
        lines.length,
        insertLine + newLines.length + 5,
      );
      const postEditContext = lines
        .slice(contextStart, contextEnd)
        .map((line, i) => `${contextStart + i + 1}\t${line}`)
        .join('\n');

      return {
        output: {
          success: true,
          appliedEdits: 1,
          totalEdits: 1,
          postEditContext,
        },
        messageMetadata,
      };
    }

    const isNewFile = args.oldText === '';

    if (isNewFile) {
      const newContent = args.newText;

      const parentDir = dirname(args.filePath);
      const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');
      const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;

      const cmd = `mkdir -p ${this.shQuote(parentDir)} && printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

      const writeResult = await this.execCommand(
        {
          cmd,
        },
        config,
        cfg,
      );

      if (writeResult.exitCode !== 0) {
        return {
          output: {
            success: false,
            error: writeResult.stderr || 'Failed to create file',
          },
          messageMetadata,
        };
      }

      return {
        output: {
          success: true,
          appliedEdits: 1,
          totalEdits: 1,
        },
        messageMetadata,
      };
    }

    const p = this.shQuote(args.filePath);
    const readResult = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);

    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: readResult.stderr || 'Failed to read file',
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;

    // Validate content hash if provided (stale-read detection)
    if (args.expectedHash) {
      const actualHash = createHash('sha256')
        .update(fileContent)
        .digest('hex')
        .slice(0, 8);
      if (actualHash !== args.expectedHash) {
        return {
          output: {
            success: false,
            error: `File has changed since last read (expected hash: ${args.expectedHash}, actual: ${actualHash}). Re-read the file with files_read before editing.`,
          },
          messageMetadata,
        };
      }
    }

    const { matches, errors, matchStage } = this.findMatchesProgressive(
      fileContent,
      args.oldText,
      args.replaceAll ?? false,
    );

    if (errors.length > 0) {
      return {
        output: {
          success: false,
          error: errors.join(' '),
        },
        messageMetadata,
      };
    }

    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const diff = this.generateDiff(originalLines, matches, args.newText);

    const modifiedContent = this.applyEdits(fileContent, matches, args.newText);

    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const cmd = `printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

    const writeResult = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (writeResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: writeResult.stderr || 'Failed to write file',
        },
        messageMetadata,
      };
    }

    // Generate post-edit context with line numbers
    const modifiedLines = modifiedContent.replace(/\r\n/g, '\n').split('\n');
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
}
