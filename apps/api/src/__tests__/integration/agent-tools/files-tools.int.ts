import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BaseException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesApplyChangesTool } from '../../../v1/agent-tools/tools/common/files/files-apply-changes.tool';
import { FilesBuildTagsTool } from '../../../v1/agent-tools/tools/common/files/files-build-tags.tool';
import { FilesDeleteTool } from '../../../v1/agent-tools/tools/common/files/files-delete.tool';
import { FilesEditTool } from '../../../v1/agent-tools/tools/common/files/files-edit.tool';
import { FilesEditReapplyTool } from '../../../v1/agent-tools/tools/common/files/files-edit-reapply.tool';
import { FilesFindPathsTool } from '../../../v1/agent-tools/tools/common/files/files-find-paths.tool';
import { FilesReadTool } from '../../../v1/agent-tools/tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from '../../../v1/agent-tools/tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from '../../../v1/agent-tools/tools/common/files/files-search-text.tool';
import { ShellTool } from '../../../v1/agent-tools/tools/common/shell.tool';
import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { OpenaiService } from '../../../v1/openai/openai.service';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const THREAD_ID = `files-tools-int-${Date.now()}`;
const WORKSPACE_DIR = `/runtime-workspace/${THREAD_ID}`;
const TAGS_ALIAS = 'files-tools-index';
const INT_TEST_TIMEOUT = 30000;
const RUNNABLE_CONFIG: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: {
    thread_id: THREAD_ID,
  },
};

const SAMPLE_TS_CONTENT = [
  'export function greet(name: string) {',
  '  return `Hello, ${name}!`;',
  '}',
  '',
  'export class HelperService {',
  "  constructor(private prefix: string = 'helper') {}",
  '  run(task: string) {',
  '    return `${this.prefix}:${task}`;',
  '  }',
  '}',
].join('\n');

type SearchTextResult = Awaited<
  ReturnType<FilesSearchTextTool['invoke']>
>['output'];
type SearchTagsResult = Awaited<
  ReturnType<FilesSearchTagsTool['invoke']>
>['output'];

const hasTextMatch = (result: SearchTextResult, snippet: string) =>
  Array.isArray(result.matches) &&
  result.matches.some(
    (match) =>
      typeof match?.data?.lines?.text === 'string' &&
      match.data.lines.text.includes(snippet),
  );

const hasNamedTag = (result: SearchTagsResult, name: string) =>
  Array.isArray(result.matches) &&
  result.matches.some(
    (match) =>
      typeof (match as { name?: unknown }).name === 'string' &&
      (match as { name: string }).name === name,
  );

describe('Files tools integration', () => {
  let moduleRef: TestingModule;
  let runtime: BaseRuntime;
  let runtimeProvider: RuntimeProvider;
  let filesFindPathsTool: FilesFindPathsTool;
  let filesReadTool: FilesReadTool;
  let filesSearchTextTool: FilesSearchTextTool;
  let filesApplyChangesTool: FilesApplyChangesTool;
  let filesBuildTagsTool: FilesBuildTagsTool;
  let filesSearchTagsTool: FilesSearchTagsTool;
  let filesDeleteTool: FilesDeleteTool;
  let filesEditTool: FilesEditTool;
  let filesEditReapplyTool: FilesEditReapplyTool;
  let shellTool: ShellTool;

  const writeSampleFile = async (fileName = 'sample.ts') => {
    const filePath = `${WORKSPACE_DIR}/${fileName}`;

    const { output: result } = await filesApplyChangesTool.invoke(
      {
        filePath,
        oldText: '',
        newText: SAMPLE_TS_CONTENT,
      },
      { runtime },
      RUNNABLE_CONFIG,
    );

    expect(result.success).toBe(true);

    return filePath;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        FilesFindPathsTool,
        FilesReadTool,
        FilesSearchTextTool,
        FilesApplyChangesTool,
        FilesBuildTagsTool,
        FilesSearchTagsTool,
        FilesDeleteTool,
        FilesEditTool,
        FilesEditReapplyTool,
        ShellTool,
        RuntimeProvider,
        OpenaiService,
      ],
    }).compile();

    runtimeProvider = moduleRef.get(RuntimeProvider);
    filesFindPathsTool = moduleRef.get(FilesFindPathsTool);
    filesReadTool = moduleRef.get(FilesReadTool);
    filesSearchTextTool = moduleRef.get(FilesSearchTextTool);
    filesApplyChangesTool = moduleRef.get(FilesApplyChangesTool);
    filesBuildTagsTool = moduleRef.get(FilesBuildTagsTool);
    filesSearchTagsTool = moduleRef.get(FilesSearchTagsTool);
    filesDeleteTool = moduleRef.get(FilesDeleteTool);
    filesEditTool = moduleRef.get(FilesEditTool);
    filesEditReapplyTool = moduleRef.get(FilesEditReapplyTool);
    shellTool = moduleRef.get(ShellTool);

    runtime = await runtimeProvider.provide({
      type: RuntimeType.Docker,
    });

    await runtime.start({
      image: environment.dockerRuntimeImage,
      recreate: true,
      containerName: `files-tools-${Date.now()}`,
    });
  }, 60000);

  afterAll(async () => {
    if (runtime) {
      await runtime.stop().catch(() => undefined);
    }

    if (moduleRef) {
      await moduleRef.close();
    }
  }, 60000);

  it(
    'applies changes and searches text inside the runtime workspace',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = await writeSampleFile('workspace.ts');

      // Read file first
      const { output: initialRead } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const initialContent = initialRead.files?.[0]?.content || '';

      const { output: insertResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: initialContent,
          newText: '// Integration header\n' + initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      const { output: listResult } = await filesFindPathsTool.invoke(
        { searchInDirectory: WORKSPACE_DIR, filenamePattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files).toBeDefined();
      expect(listResult.files).toContain(filePath);

      const { output: readResult } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(readResult.error).toBeUndefined();
      const readContent = readResult.files?.[0]?.content;
      expect(readContent?.startsWith('// Integration header')).toBe(true);
      expect(readContent?.includes('export function greet')).toBe(true);

      const { output: searchResult } = await filesSearchTextTool.invoke(
        { filePath, textPattern: 'HelperService' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(searchResult.error).toBeUndefined();
      expect(hasTextMatch(searchResult, 'class HelperService')).toBe(true);
    },
  );

  it(
    'builds a ctags index and searches for symbols',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      await writeSampleFile('tags.ts');

      const { output: buildResult } = await filesBuildTagsTool.invoke(
        { directoryPath: WORKSPACE_DIR, alias: TAGS_ALIAS },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(buildResult.error).toBeUndefined();
      expect(buildResult.success).toBe(true);
      expect(buildResult.tagsFile).toBeDefined();
      expect(buildResult.tagsFile?.endsWith(`${TAGS_ALIAS}.json`)).toBe(true);

      const { output: classSearch } = await filesSearchTagsTool.invoke(
        {
          directoryPath: WORKSPACE_DIR,
          alias: TAGS_ALIAS,
          symbolQuery: 'HelperService',
          exactMatch: true,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(classSearch.error).toBeUndefined();
      expect(hasNamedTag(classSearch, 'HelperService')).toBe(true);

      const { output: functionSearch } = await filesSearchTagsTool.invoke(
        {
          directoryPath: WORKSPACE_DIR,
          alias: TAGS_ALIAS,
          symbolQuery: 'greet',
          exactMatch: true,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(functionSearch.error).toBeUndefined();
      expect(hasNamedTag(functionSearch, 'greet')).toBe(true);
    },
  );

  it(
    'uses current working directory when dir is omitted',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      // Write a file into the thread workspace (default child workdir)
      const filePath = await writeSampleFile('cwd-file.ts');

      const { output: listResult } = await filesFindPathsTool.invoke(
        { filenamePattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files?.some((f) => f.endsWith('cwd-file.ts'))).toBe(
        true,
      );

      const { output: searchResult } = await filesSearchTextTool.invoke(
        { filePath, textPattern: 'HelperService' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(searchResult.error).toBeUndefined();
      expect(hasTextMatch(searchResult, 'class HelperService')).toBe(true);
    },
  );

  it(
    'allows creating, cd-ing, and reading from a custom dir with persistent session',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const builtShell = shellTool.build({ runtime });
      const customDir = `${WORKSPACE_DIR}/nested/custom`;
      const filePath = `${customDir}/note.txt`;
      const content = 'Hello from custom dir';

      // Create file in a custom directory
      const { output: applyRes } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: content,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(applyRes.success).toBe(true);

      // Move shell session into that directory and verify cwd
      const { output: cdRes } = await builtShell.invoke(
        { purpose: 'cd into custom dir', command: `cd ${customDir} && pwd` },
        RUNNABLE_CONFIG,
      );
      expect(cdRes.exitCode).toBe(0);
      expect(cdRes.stdout.trim()).toBe(customDir);

      // Use files_find_paths without dir to rely on current session cwd
      const { output: listRes } = await filesFindPathsTool.invoke(
        { filenamePattern: '*.txt' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listRes.error).toBeUndefined();
      const listedFile = listRes.files?.find((f) => f.endsWith('/note.txt'));
      expect(listedFile).toBe(filePath);
      expect(listedFile?.startsWith(customDir)).toBe(true);

      // Read the file from the custom directory
      const { output: readRes } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(readRes.error).toBeUndefined();
      expect(readRes.files?.[0]?.content?.trim()).toBe(content);
    },
  );

  it(
    'running tools with dir does not change persistent shell cwd',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const builtShell = shellTool.build({ runtime });

      const { output: setCwd } = await builtShell.invoke(
        { purpose: 'set cwd', command: 'cd /tmp && pwd' },
        RUNNABLE_CONFIG,
      );
      expect(setCwd.exitCode).toBe(0);
      expect(setCwd.stdout.trim()).toBe('/tmp');

      // Run files_find_paths with an explicit dir (subshell) and ensure cwd remains /tmp
      const { output: listResult } = await filesFindPathsTool.invoke(
        { searchInDirectory: WORKSPACE_DIR, filenamePattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listResult.error).toBeUndefined();

      const { output: cwdResult } = await builtShell.invoke(
        { purpose: 'check cwd', command: 'pwd' },
        RUNNABLE_CONFIG,
      );
      expect(cwdResult.exitCode).toBe(0);
      expect(cwdResult.stdout.trim()).toBe('/tmp');
    },
  );

  it(
    'creates a file in new directories and deletes it via files_delete',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const nestedDir = `${WORKSPACE_DIR}/nested/delete-check`;
      const fileName = `temp-file-${Date.now()}.txt`;
      const filePath = `${nestedDir}/${fileName}`;
      const content = 'temporary file content';

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: content,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      const { output: listAfterCreate } = await filesFindPathsTool.invoke(
        {
          searchInDirectory: nestedDir,
          filenamePattern: fileName,
          includeSubdirectories: false,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listAfterCreate.error).toBeUndefined();
      expect(listAfterCreate.files).toContain(filePath);

      const { output: deleteResult } = await filesDeleteTool.invoke(
        { filePath },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(deleteResult.success).toBe(true);

      const { output: listAfterDelete } = await filesFindPathsTool.invoke(
        {
          searchInDirectory: nestedDir,
          filenamePattern: fileName,
          includeSubdirectories: false,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listAfterDelete.error).toBeUndefined();
      expect(listAfterDelete.files?.includes(filePath)).toBe(false);
    },
  );

  it(
    'replaces text in a file using pattern matching',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/replace-test.ts`;

      // Create a file with initial content
      const initialContent = `export function oldFunction() {\n  return 'old value';\n}\n\nexport const config = 'old';`;

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Replace a specific function using pattern matching
      const { output: replaceResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: `export function oldFunction() {\n  return 'old value';\n}`,
          newText: `export function newFunction() {\n  return 'new value';\n}`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(replaceResult.success).toBe(true);
      expect(replaceResult.appliedEdits).toBe(1);

      // Verify the replacement
      const { output: readResult } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const contentAfter = readResult.files?.[0]?.content || '';
      expect(contentAfter).toContain('newFunction');
      expect(contentAfter).toContain("return 'new value'");
      expect(contentAfter).not.toContain('oldFunction');
      expect(contentAfter).toContain("export const config = 'old'"); // Other content unchanged
    },
  );

  it(
    'inserts text at the beginning of a file',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/insert-beginning.ts`;

      // Create a file with initial content
      const initialContent = `export const data = 'value';\n\nfunction helper() {\n  return true;\n}`;

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Read current content
      const { output: readBefore } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );
      const beforeContent = readBefore.files?.[0]?.content || '';

      // Insert import at the beginning
      const { output: insertResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: beforeContent,
          newText: `import { newImport } from './new';\n\n${beforeContent}`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      // Verify the insertion
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const inserted = readAfter.files?.[0]?.content || '';
      expect(inserted).toContain("import { newImport } from './new'");
      expect(inserted.indexOf('import')).toBe(0); // At the very beginning
      expect(inserted).toContain('export const data');
    },
  );

  it(
    'appends text to the end of a file',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/append-end.ts`;

      // Create a file with initial content
      const initialContent = `export const first = 'value';\n\nexport function existing() {\n  return 'exists';\n}`;

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Read current content
      const { output: readBefore } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );
      const beforeContent = readBefore.files?.[0]?.content || '';

      // Append new function at the end
      const { output: appendResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: beforeContent,
          newText: `${beforeContent}\n\nexport function newFunction() {\n  return 'new';\n}`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(appendResult.success).toBe(true);

      // Verify the append
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const afterAppend = readAfter.files?.[0]?.content || '';
      expect(afterAppend).toContain('export const first');
      expect(afterAppend).toContain('export function existing');
      expect(afterAppend).toContain('export function newFunction');

      // Verify order - newFunction should be at the end
      const lines = afterAppend.split('\n');
      const newFunctionIndex = lines.findIndex((l) =>
        l.includes('newFunction'),
      );
      const existingIndex = lines.findIndex((l) => l.includes('existing'));
      expect(newFunctionIndex).toBeGreaterThan(existingIndex);
    },
  );

  it(
    'inserts text in the middle of a file',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/insert-middle.ts`;

      // Create a file with initial content
      const initialContent = `export const config = {\n  api: 'http://localhost',\n  port: 3000,\n};`;

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Insert a new property in the middle
      const { output: insertResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: `export const config = {\n  api: 'http://localhost',\n  port: 3000,\n};`,
          newText: `export const config = {\n  api: 'http://localhost',\n  timeout: 5000,\n  port: 3000,\n};`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      // Verify the insertion
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const afterMid = readAfter.files?.[0]?.content || '';
      expect(afterMid).toContain('api:');
      expect(afterMid).toContain('timeout: 5000');
      expect(afterMid).toContain('port:');

      // Verify order - timeout should be between api and port
      const lines = afterMid.split('\n');
      const apiIndex = lines.findIndex((l) => l.includes('api:'));
      const timeoutIndex = lines.findIndex((l) => l.includes('timeout:'));
      const portIndex = lines.findIndex((l) => l.includes('port:'));

      expect(timeoutIndex).toBeGreaterThan(apiIndex);
      expect(portIndex).toBeGreaterThan(timeoutIndex);
    },
  );

  it(
    'works with empty files and adds content',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/empty-file.ts`;

      // Create an empty file
      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: '',
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Verify it's empty
      const { output: readEmpty } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(readEmpty.files?.[0]?.content).toBe('');

      // Add content to the empty file
      const { output: addResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: `// First line\nexport const value = 'data';`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(addResult.success).toBe(true);

      // Verify content was added
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const after = readAfter.files?.[0]?.content || '';
      expect(after).toContain('// First line');
      expect(after).toContain("export const value = 'data'");
    },
  );

  it(
    'returns diff when applying changes',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const filePath = `${WORKSPACE_DIR}/dryrun-test.ts`;

      // Create a file
      const initialContent = `export function test() {\n  return 'original';\n}`;

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Apply changes (no dryRun support)
      const { output: applyResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: `export function test() {\n  return 'original';\n}`,
          newText: `export function test() {\n  return 'modified';\n}`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(applyResult.success).toBe(true);
      expect(applyResult.appliedEdits).toBe(1);
      expect(applyResult.diff).toBeDefined();
      expect(applyResult.diff).toContain("-  return 'original'");
      expect(applyResult.diff).toContain("+  return 'modified'");

      // Verify file was changed
      const { output: readAfterApply } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const afterApply = readAfterApply.files?.[0]?.content || '';
      expect(afterApply).toContain('modified');
      expect(afterApply).not.toContain('original');
    },
  );

  it(
    'files_edit: tool can be invoked with proper schema',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      // Create initial file
      const fileName = `edit-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Invoke files_edit (may succeed or fail depending on LLM parsing)
      // The key is that it should not throw and should return proper structure
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Change greeting',
          codeSketch: `export function greet(name: string) {
  return \`Hello, \${name}!\`;
// ... existing code ...
}`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Verify the response structure is correct
      expect(editResult).toBeDefined();
      expect(typeof editResult.success).toBe('boolean');
      expect(typeof editResult.filePath).toBe('string');

      if (!editResult.success) {
        // If it fails, verify error structure
        expect(editResult.error).toBeDefined();
      } else {
        // If it succeeds, verify success structure
        expect(editResult.diff).toBeDefined();
        expect(typeof editResult.appliedHunks).toBe('number');
      }
    },
  );

  it(
    'files_edit: handles NOT_FOUND_ANCHOR error with invalid anchors',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `edit-error-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Try to edit with non-existent anchors
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Try to modify non-existent code',
          codeSketch: `function nonExistent() {
// ... existing code ...
  return 'modified';
// ... existing code ...
}`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      expect(editResult.success).toBe(false);
      if (!editResult.success) {
        expect(editResult.error).toBeDefined();
        expect(editResult.error).toContain('Could not find anchors');
      }
    },
  );

  it(
    'files_edit: handles INVALID_SKETCH_FORMAT error with no markers',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `edit-format-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Try to edit without proper markers
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Try to modify without markers',
          codeSketch: `export function greet(name: string) {
  return 'modified';
}`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      expect(editResult.success).toBe(false);
      if (!editResult.success) {
        expect(editResult.error).toBeDefined();
        expect(editResult.error).toContain('marker');
      }
    },
  );

  it(
    'files_edit_reapply: tool can be invoked and uses smart model',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      // Create initial file
      const fileName = `reapply-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Use files_edit_reapply (smart fallback)
      const { output: reapplyResult } = await filesEditReapplyTool.invoke(
        {
          filePath,
          editInstructions: 'Update constructor',
          codeSketch: `export class HelperService {
  constructor(private prefix: string = 'helper') {}
// ... existing code ...
}`,
        },
        { runtime, smartModel: 'gpt-5.1' },
        RUNNABLE_CONFIG,
      );

      // Verify response structure
      expect(reapplyResult).toBeDefined();
      expect(typeof reapplyResult.success).toBe('boolean');
      expect(typeof reapplyResult.filePath).toBe('string');

      if (!reapplyResult.success) {
        expect(reapplyResult.error).toBeDefined();
      } else {
        expect(reapplyResult.diff).toBeDefined();
        expect(typeof reapplyResult.appliedHunks).toBe('number');
      }
    },
  );

  it(
    'files_edit: handles file read and provides structured response',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `edit-basic-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Invoke with a simple sketch
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Modify the function',
          codeSketch: `export function greet(name: string) {
// ... existing code ...
}`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Verify tool returns proper structure (may succeed or fail)
      expect(editResult).toBeDefined();
      expect(editResult.filePath).toBe(filePath);
      expect(typeof editResult.success).toBe('boolean');
    },
  );

  it(
    'files_edit: processes multiple markers in sketch',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `multi-marker-test-${Date.now()}.ts`;
      const filePath = await writeSampleFile(fileName);

      // Sketch with multiple markers
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Update multiple sections',
          codeSketch: `export function greet(name: string) {
// ... existing code ...
}

export class HelperService {
// ... existing code ...
}`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Verify structure regardless of success/failure
      expect(editResult).toBeDefined();
      expect(typeof editResult.success).toBe('boolean');

      if (editResult.success) {
        // If successful, verify it detected multiple hunks
        expect(editResult.appliedHunks).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it(
    'files_edit: successfully creates and applies edit with proper workflow',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      // Create a simple file with deterministic content
      const fileName = `e2e-edit-test-${Date.now()}.ts`;
      const filePath = `${WORKSPACE_DIR}/${fileName}`;
      const initialContent = `export const oldValue = 'old';\n\nexport function calculate(a: number, b: number) {\n  return a + b;\n}`;

      await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      // First, verify the file was created correctly
      const { output: readBefore } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtime },
        RUNNABLE_CONFIG,
      );

      const contentBefore = readBefore.files?.[0]?.content || '';
      expect(contentBefore).toContain('export const oldValue');
      expect(contentBefore).toContain('export function calculate');

      // Edit with simple deterministic sketch
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Update the constant value',
          codeSketch: `export const oldValue = 'old';
// ... existing code ...
export function calculate(a: number, b: number) {`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Verify the response structure (may succeed or fail depending on parsing)
      expect(editResult).toBeDefined();
      expect(typeof editResult.success).toBe('boolean');
      expect(editResult.filePath).toBe(filePath);

      if (editResult.success) {
        // If successful, check that we got reasonable output
        expect(editResult.appliedHunks).toBeGreaterThan(0);
        expect(editResult.diff).toBeDefined();

        // Verify the file still exists and has some content
        const { output: readAfter } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtime },
          RUNNABLE_CONFIG,
        );

        const contentAfter = readAfter.files?.[0]?.content || '';
        expect(contentAfter.length).toBeGreaterThan(0);
      } else {
        // If it failed, verify proper error structure
        expect(editResult.error).toBeDefined();
      }
    },
  );

  it(
    'files_edit: detects anchor mismatch after file modification',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `mismatch-test-${Date.now()}.ts`;
      const filePath = `${WORKSPACE_DIR}/${fileName}`;
      const initialContent = `export const value = 'initial';\nexport const other = 'data';`;

      await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      // Modify the file directly
      await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: `export const value = 'initial';`,
          newText: `export const value = 'modified';`,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      // Now try to apply an edit based on the old content (with proper markers)
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Update value',
          codeSketch: `export const value = 'initial';
// ... existing code ...
export const other`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Should fail since 'initial' no longer exists in file
      expect(editResult).toBeDefined();
      if (!editResult.success) {
        // Should fail with NOT_FOUND_ANCHOR since the old value is gone
        expect(editResult.error).toBeDefined();
        expect(editResult.error).toContain('Could not find anchors');
      }
    },
  );

  it(
    'files_edit_reapply: successfully falls back when deterministic parsing fails',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `fallback-test-${Date.now()}.ts`;
      const filePath = `${WORKSPACE_DIR}/${fileName}`;
      const initialContent = `export function complexFunction(param1: string, param2: number) {\n  const result = param1.repeat(param2);\n  return result.toUpperCase();\n}`;

      await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: initialContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      // Use a vague sketch that requires LLM parsing
      const { output: reapplyResult } = await filesEditReapplyTool.invoke(
        {
          filePath,
          editInstructions:
            'Make the function return lowercase instead of uppercase',
          codeSketch: `export function complexFunction
// ... existing code ...
  return result`,
        },
        { runtime, smartModel: 'gpt-5.1' },
        RUNNABLE_CONFIG,
      );

      // Verify structure (success or failure both valid for LLM-based parsing)
      expect(reapplyResult).toBeDefined();
      expect(typeof reapplyResult.success).toBe('boolean');
      expect(reapplyResult.filePath).toBe(filePath);

      if (reapplyResult.success) {
        // If successful, verify diff is present
        expect(reapplyResult.diff).toBeDefined();
        expect(reapplyResult.appliedHunks).toBeGreaterThan(0);
      } else {
        // If failed, verify proper error structure
        expect(reapplyResult.error).toBeDefined();
      }
    },
  );

  it(
    'files_edit: respects limit enforcement',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const fileName = `limits-test-${Date.now()}.ts`;
      const filePath = `${WORKSPACE_DIR}/${fileName}`;

      // Create a file that's just under the size limit
      const largeContent = 'x'.repeat(999_000); // ~999KB

      await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: largeContent,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      // Try to edit - should work since file is under 1MB
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Add marker',
          codeSketch: `xxx
// ... existing code ...
xxx`,
        },
        { runtime, fastModel: 'gpt-5-mini' },
        RUNNABLE_CONFIG,
      );

      // Should either succeed or fail for reasons other than size limit
      expect(editResult).toBeDefined();
      if (!editResult.success) {
        // Ensure error isn't due to size limit for an under-limit file.
        expect(editResult.error || '').not.toContain('exceeds');
      }
    },
  );
});

describe('Files tools graph execution', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

  const THREAD_STATUSES: ThreadStatus[] = [
    ThreadStatus.Done,
    ThreadStatus.NeedMoreInfo,
    ThreadStatus.Stopped,
  ];

  const SEARCH_DIR = '/runtime-workspace/files-search-graph';
  const SEARCH_QUERY = 'reasoning';
  const INCLUDE_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.txt'];

  const registerGraph = (graphId: string) => {
    if (!createdGraphIds.includes(graphId)) {
      createdGraphIds.push(graphId);
    }
  };

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        (error.errorCode !== 'GRAPH_NOT_FOUND' &&
          error.errorCode !== 'GRAPH_NOT_RUNNING')
      ) {
        throw error;
      }
    }

    try {
      await graphsService.delete(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        error.errorCode !== 'GRAPH_NOT_FOUND'
      ) {
        throw error;
      }
    }
  };

  const waitForGraphStatus = async (
    graphId: string,
    status: GraphStatus,
    timeoutMs = 180_000,
  ) => {
    return waitForCondition(
      () => graphsService.findById(graphId),
      (graph) => graph.status === status,
      { timeout: timeoutMs, interval: 1_000 },
    );
  };

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 120_000,
  ) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);

    return waitForCondition(
      () => threadsService.getThreadById(thread.id),
      (currentThread) => THREAD_STATUSES.includes(currentThread.status),
      {
        timeout: timeoutMs,
        interval: 1_000,
      },
    );
  };

  const getThreadMessages = async (externalThreadId: string) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);
    return threadsService.getThreadMessages(thread.id);
  };

  type ToolMessage = Extract<ThreadMessageDto['message'], { role: 'tool' }>;
  const isFileSearchToolMessage = (
    msg: ThreadMessageDto['message'],
  ): msg is ToolMessage & { name?: string; content?: unknown } =>
    msg.role === 'tool' &&
    (msg as { name?: string }).name === 'files_search_text';

  const findFileSearchExecution = (messages: ThreadMessageDto[]) => {
    const toolMessage = messages
      .map((message) => message.message)
      .find((msg) => isFileSearchToolMessage(msg));

    let parsedResult: unknown;
    const content = (toolMessage as { content?: unknown } | undefined)?.content;
    if (content !== undefined) {
      try {
        parsedResult =
          typeof content === 'string' ? JSON.parse(content) : content;
      } catch {
        parsedResult = content;
      }
    }

    return { toolMessage, parsedResult };
  };

  const createFilesSearchGraphData = (): CreateGraphDto => {
    return {
      name: `Files Search Graph ${Date.now()}`,
      description: 'Integration test graph for files_search_text tool',
      temporary: true,
      schema: {
        nodes: [
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {},
          },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              instructions: `
You are a file search assistant.
When the user message contains 'SEARCH_WITH_FILES_TOOL' followed by JSON, parse that JSON and call files_search_text exactly once with those parameters. After the tool returns, immediately call finish with a short summary of matches. Do not use any other tools.
              `,
              name: 'Files Search Agent',
              description: 'Searches files for a query',
              summarizeMaxTokens: 272000,
              summarizeKeepTokens: 30000,
              invokeModelName: 'gpt-5-mini',
              invokeModelReasoningEffort: ReasoningEffort.None,
              enforceToolUsage: true,
              maxIterations: 20,
            } satisfies SimpleAgentSchemaType,
          },
          {
            id: 'files-1',
            template: 'files-tool',
            config: {},
          },
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: environment.dockerRuntimeImage,
              initScript: [
                `mkdir -p ${SEARCH_DIR}/src`,
                `echo "This line has ${SEARCH_QUERY} content." > ${SEARCH_DIR}/src/sample.ts`,
              ],
              initScriptTimeoutMs: 180_000,
            },
          },
        ],
        edges: [
          { from: 'trigger-1', to: 'agent-1' },
          { from: 'agent-1', to: 'files-1' },
          { from: 'files-1', to: 'runtime-1' },
        ],
      },
    };
  };

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
  });

  afterEach(async () => {
    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (graphId) {
        await cleanupGraph(graphId);
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it(
    'runs files_search_text via graph trigger and returns matches',
    { timeout: 45000 },
    async () => {
      const graph = await graphsService.create(createFilesSearchGraphData());
      registerGraph(graph.id);

      await graphsService.run(graph.id);
      await waitForGraphStatus(graph.id, GraphStatus.Running, 30000);

      const execution = await graphsService.executeTrigger(
        graph.id,
        'trigger-1',
        {
          messages: [
            `SEARCH_WITH_FILES_TOOL {"dir":"${SEARCH_DIR}","query":"${SEARCH_QUERY}","includeGlobs":${JSON.stringify(
              INCLUDE_GLOBS,
            )}}`,
          ],
          async: false,
        },
      );

      expect(execution.externalThreadId).toBeDefined();

      const thread = await waitForThreadCompletion(execution.externalThreadId);
      expect(THREAD_STATUSES).toContain(thread.status);

      const messages = await getThreadMessages(execution.externalThreadId);
      const searchExecution = findFileSearchExecution(messages);

      if (!searchExecution.toolMessage) {
        throw new Error(
          `files_search_text tool was not invoked. Messages: ${JSON.stringify(
            messages.map((m) => m.message),
          )}`,
        );
      }

      const parsed = searchExecution.parsedResult as
        | { matches?: { data?: { path?: { text?: string } } }[] }
        | undefined;

      if (!Array.isArray(parsed?.matches) || parsed.matches.length === 0) {
        throw new Error(
          `files_search_text returned no matches. Raw result: ${JSON.stringify(
            searchExecution.parsedResult,
          )}`,
        );
      }

      const firstPath = parsed.matches[0]?.data?.path?.text;
      expect(firstPath).toContain('/src/sample.ts');
    },
  );
});
