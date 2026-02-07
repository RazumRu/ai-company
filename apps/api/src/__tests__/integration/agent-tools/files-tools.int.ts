import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BaseException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import dedent from 'dedent';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesApplyChangesTool } from '../../../v1/agent-tools/tools/common/files/files-apply-changes.tool';
import { FilesDeleteTool } from '../../../v1/agent-tools/tools/common/files/files-delete.tool';
import { FilesEditTool } from '../../../v1/agent-tools/tools/common/files/files-edit.tool';
import { FilesFindPathsTool } from '../../../v1/agent-tools/tools/common/files/files-find-paths.tool';
import { FilesReadTool } from '../../../v1/agent-tools/tools/common/files/files-read.tool';
import { FilesSearchTextTool } from '../../../v1/agent-tools/tools/common/files/files-search-text.tool';
import { ShellTool } from '../../../v1/agent-tools/tools/common/shell.tool';
import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { LiteLlmClient } from '../../../v1/litellm/services/litellm.client';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { LlmModelsService } from '../../../v1/litellm/services/llm-models.service';
import { OpenaiService } from '../../../v1/openai/openai.service';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../v1/runtime/services/runtime-thread-provider';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

const THREAD_ID = `files-tools-int-${Date.now()}`;
const WORKSPACE_DIR = `/runtime-workspace/${THREAD_ID}`;
const INT_TEST_TIMEOUT = 60000;
const RUNNABLE_CONFIG: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: {
    thread_id: THREAD_ID,
  },
};

/**
 * Strip NNN\t line-number prefixes returned by files_read so the raw content
 * can be fed to files_apply_changes (which expects un-numbered text).
 */
function stripLineNumbers(numberedContent: string): string {
  return numberedContent
    .split('\n')
    .map((line) => line.replace(/^\d+\t/, ''))
    .join('\n');
}

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

const hasTextMatch = (result: SearchTextResult, snippet: string) =>
  Array.isArray(result.matches) &&
  result.matches.some(
    (match) =>
      typeof match?.data?.lines?.text === 'string' &&
      match.data.lines.text.includes(snippet),
  );

const contextDataStorage = new AuthContextStorage({ sub: TEST_USER_ID });

describe('Files tools integration', () => {
  let moduleRef: TestingModule;
  let runtime: BaseRuntime;
  let runtimeThreadProvider: RuntimeThreadProvider;
  let filesFindPathsTool: FilesFindPathsTool;
  let filesReadTool: FilesReadTool;
  let filesSearchTextTool: FilesSearchTextTool;
  let filesApplyChangesTool: FilesApplyChangesTool;
  let filesDeleteTool: FilesDeleteTool;
  let filesEditTool: FilesEditTool;
  let shellTool: ShellTool;

  const writeSampleFile = async (fileName = 'sample.ts') => {
    const filePath = `${WORKSPACE_DIR}/${fileName}`;

    const { output: result } = await filesApplyChangesTool.invoke(
      {
        filePath,
        oldText: '',
        newText: SAMPLE_TS_CONTENT,
      },
      { runtimeProvider: runtimeThreadProvider },
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
        FilesDeleteTool,
        FilesEditTool,
        ShellTool,
        OpenaiService,
        LitellmService,
        LiteLlmClient,
        LlmModelsService,
      ],
    }).compile();

    filesFindPathsTool = moduleRef.get(FilesFindPathsTool);
    filesReadTool = moduleRef.get(FilesReadTool);
    filesSearchTextTool = moduleRef.get(FilesSearchTextTool);
    filesApplyChangesTool = moduleRef.get(FilesApplyChangesTool);
    filesDeleteTool = moduleRef.get(FilesDeleteTool);
    filesEditTool = moduleRef.get(FilesEditTool);
    shellTool = moduleRef.get(ShellTool);

    runtime = new DockerRuntime({ socketPath: environment.dockerSocket });

    await runtime.start({
      image: environment.dockerRuntimeImage,
      recreate: true,
      containerName: `files-tools-${Date.now()}`,
    });

    runtimeThreadProvider = new RuntimeThreadProvider(
      {
        provide: async () => ({ runtime, created: false }),
      } as unknown as RuntimeProvider,
      {
        graphId: `graph-${Date.now()}`,
        runtimeNodeId: `runtime-${Date.now()}`,
        type: RuntimeType.Docker,
        runtimeStartParams: {
          image: environment.dockerRuntimeImage,
        },
        temporary: true,
      },
    );
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const initialContentNumbered = initialRead.files?.[0]?.content || '';
      const initialContent = stripLineNumbers(initialContentNumbered);

      const { output: insertResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: initialContent,
          newText: '// Integration header\n' + initialContent,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      const { output: listResult } = await filesFindPathsTool.invoke(
        { searchInDirectory: WORKSPACE_DIR, filenamePattern: '*.ts' },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files).toBeDefined();
      expect(listResult.files).toContain(filePath);

      const { output: readResult } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(readResult.error).toBeUndefined();
      const readContent = readResult.files?.[0]?.content;
      expect(readContent).toContain('// Integration header');
      expect(readContent).toContain('export function greet');

      const { output: searchResult } = await filesSearchTextTool.invoke(
        { filePath, textPattern: 'HelperService' },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(searchResult.error).toBeUndefined();
      expect(hasTextMatch(searchResult, 'class HelperService')).toBe(true);
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files?.some((f) => f.endsWith('cwd-file.ts'))).toBe(
        true,
      );

      const { output: searchResult } = await filesSearchTextTool.invoke(
        { filePath, textPattern: 'HelperService' },
        { runtimeProvider: runtimeThreadProvider },
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
      const builtShell = shellTool.build({
        runtimeProvider: runtimeThreadProvider,
      });
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
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(listRes.error).toBeUndefined();
      const listedFile = listRes.files?.find((f) => f.endsWith('/note.txt'));
      expect(listedFile).toBe(filePath);
      expect(listedFile?.startsWith(customDir)).toBe(true);

      // Read the file from the custom directory
      const { output: readRes } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(readRes.error).toBeUndefined();
      expect(stripLineNumbers(readRes.files?.[0]?.content || '').trim()).toBe(
        content,
      );
    },
  );

  it(
    'running tools with dir does not change persistent shell cwd',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const builtShell = shellTool.build({
        runtimeProvider: runtimeThreadProvider,
      });

      const { output: setCwd } = await builtShell.invoke(
        { purpose: 'set cwd', command: 'cd /tmp && pwd' },
        RUNNABLE_CONFIG,
      );
      expect(setCwd.exitCode).toBe(0);
      expect(setCwd.stdout.trim()).toBe('/tmp');

      // Run files_find_paths with an explicit dir (subshell) and ensure cwd remains /tmp
      const { output: listResult } = await filesFindPathsTool.invoke(
        { searchInDirectory: WORKSPACE_DIR, filenamePattern: '*.ts' },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      const { output: listAfterCreate } = await filesFindPathsTool.invoke(
        {
          searchInDirectory: nestedDir,
          filenamePattern: fileName,
          includeSubdirectories: false,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      expect(listAfterCreate.error).toBeUndefined();
      expect(listAfterCreate.files).toContain(filePath);

      const { output: deleteResult } = await filesDeleteTool.invoke(
        { filePath },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(deleteResult.success).toBe(true);

      const { output: listAfterDelete } = await filesFindPathsTool.invoke(
        {
          searchInDirectory: nestedDir,
          filenamePattern: fileName,
          includeSubdirectories: false,
        },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(replaceResult.success).toBe(true);
      expect(replaceResult.appliedEdits).toBe(1);

      // Verify the replacement
      const { output: readResult } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Read current content
      const { output: readBefore } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const beforeContent = stripLineNumbers(
        readBefore.files?.[0]?.content || '',
      );

      // Insert import at the beginning
      const { output: insertResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: beforeContent,
          newText: `import { newImport } from './new';\n\n${beforeContent}`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      // Verify the insertion
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const inserted = readAfter.files?.[0]?.content || '';
      expect(inserted).toContain("import { newImport } from './new'");
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Read current content
      const { output: readBefore } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const beforeContent = stripLineNumbers(
        readBefore.files?.[0]?.content || '',
      );

      // Append new function at the end
      const { output: appendResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: beforeContent,
          newText: `${beforeContent}\n\nexport function newFunction() {\n  return 'new';\n}`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(appendResult.success).toBe(true);

      // Verify the append
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      // Verify the insertion
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      // Verify it's empty
      const { output: readEmpty } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      // Empty file now gets a single numbered line: "1\t"
      expect(readEmpty.files?.[0]?.content).toBe('1\t');

      // Add content to the empty file
      const { output: addResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          oldText: '',
          newText: `// First line\nexport const value = 'data';`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(addResult.success).toBe(true);

      // Verify content was added
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
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
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      const afterApply = readAfterApply.files?.[0]?.content || '';
      expect(afterApply).toContain('modified');
      expect(afterApply).not.toContain('original');
    },
  );

  // --- files_edit tests with real LLM calls ---
  // These tests use the real LLM (via LiteLLM proxy) and rely on well-structured
  // sketches and instructions to produce deterministic results.
  // The full FilesEditTool pipeline runs end-to-end.

  it(
    'files_edit: succeeds on a simple, unambiguous edit',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const unique = `UNIQUE_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const filePath = `${WORKSPACE_DIR}/files-edit-success-${unique}.ts`;
      const keepBlock = Array.from(
        { length: 12 },
        (_, i) => `export const keep_${unique}_${i} = ${i};`,
      ).join('\n');
      const initialContent = `export function greet(name: string) {
  return \`Hello, \${name}!\`;
}

// ${unique}_BEFORE
export const value = 'old';
${keepBlock}
// ${unique}_AFTER
export const tail_${unique} = true;
`;

      await filesApplyChangesTool.invoke(
        { filePath, oldText: '', newText: initialContent },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      // Invoke files_edit with markers and strong, unique anchors
      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: dedent`
            Change the single line between the anchors from:
              export const value = 'old';
            to:
              export const value = 'new';

            Use these EXACT anchors from the CURRENT FILE:
            beforeAnchor (must be exactly this line):
              // ${unique}_BEFORE
            afterAnchor (must be exactly this line):
              // ${unique}_AFTER

            The replacement MUST be the line that goes BETWEEN those anchors (do not add it after afterAnchor).
          `,
          codeSketch: `export function greet(name: string) {
  return \`Hello, \${name}!\`;
}

// ... existing code ...
// ${unique}_BEFORE
export const value = 'new';
${keepBlock}
// ... existing code ...
// ${unique}_AFTER
export const tail_${unique} = true;
// ... existing code ...`,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      if (!editResult.success) {
        console.error('files_edit success test failed:', editResult.error);
        throw new Error(
          `files_edit expected success but got: ${editResult.error}`,
        );
      }

      expect(editResult.filePath).toBe(filePath);
      expect(editResult.diff).toBeDefined();
      expect(editResult.appliedHunks).toBeGreaterThan(0);

      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const contentAfter = readAfter.files?.[0]?.content || '';
      expect(contentAfter).toContain("export const value = 'new'");
    },
  );

  it(
    'files_edit: returns structured error response when file does not exist',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const unique = `NOFILE_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      // Reference a file that was never created — deterministic error, no LLM involved
      const filePath = `${WORKSPACE_DIR}/nonexistent-${unique}.ts`;

      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: 'Add a greeting function.',
          codeSketch: [
            'export function greet() {',
            '  return "hello";',
            '}',
            '// ... existing code ...',
          ].join('\n'),
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      expect(editResult.success).toBe(false);
      expect(editResult.filePath).toBe(filePath);

      // Narrow the discriminated union so TS knows `.error` exists
      if (!editResult.success) {
        expect(editResult.error).toBeDefined();
        expect(typeof editResult.error).toBe('string');
        expect(editResult.error.length).toBeGreaterThan(0);
      }
    },
  );

  it(
    'files_edit: handles markerless sketch as full rewrite',
    { timeout: INT_TEST_TIMEOUT * 2 },
    async () => {
      const unique = `MARKERLESS_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const fileName = `edit-format-test-${unique}.ts`;
      const filePath = `${WORKSPACE_DIR}/${fileName}`;
      // Very small file — ensures full content fits in context
      const initialContent = `// ${unique}\nexport const value = 'hello';\n`;

      await filesApplyChangesTool.invoke(
        { filePath, oldText: '', newText: initialContent },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      // Markerless sketch (no "// ... existing code ..." markers)
      // The LLM should treat this as a full file rewrite with empty anchors
      const newContent = `// ${unique}\nexport const value = 'modified';\n`;

      const { output: editResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: dedent`
            Full file rewrite. Replace the string 'hello' with 'modified'.
            This is a markerless sketch — output exactly one hunk with beforeAnchor="" and afterAnchor="" and replacement equal to the entire sketch verbatim.
          `,
          codeSketch: newContent,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      if (!editResult.success) {
        console.error(
          'files_edit markerless rewrite failed:',
          editResult.error,
        );
        throw new Error(
          `files_edit markerless rewrite expected success but got: ${editResult.error}`,
        );
      }

      expect(editResult.success).toBe(true);
      expect(editResult.appliedHunks).toBeGreaterThan(0);

      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const contentAfter = stripLineNumbers(
        readAfter.files?.[0]?.content || '',
      );
      expect(contentAfter).toContain("value = 'modified'");
    },
  );

  it(
    'files_edit with useSmartModel: uses smart model flag',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const unique = `SMART_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const filePath = `${WORKSPACE_DIR}/files-edit-smart-model-${unique}.ts`;

      // Use markers (not markerless) for more deterministic behavior
      const initialContent = [
        `// ${unique}_START`,
        'export function greet(name: string): string {',
        '  return `Hello, ${name}!`;',
        '}',
        `// ${unique}_END`,
        '',
      ].join('\n');

      await filesApplyChangesTool.invoke(
        { filePath, oldText: '', newText: initialContent },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      // Use sketch WITH "// ... existing code ..." markers for proper marker-based mode
      const { output: smartModelResult } = await filesEditTool.invoke(
        {
          filePath,
          editInstructions: dedent`
            Change the greeting from Hello to Hi.
            Use beforeAnchor="// ${unique}_START" and afterAnchor="// ${unique}_END" exactly.
            The replacement is everything between those anchors with Hello changed to Hi.
          `,
          codeSketch: [
            `// ${unique}_START`,
            'export function greet(name: string): string {',
            '  return `Hi, ${name}!`;',
            '}',
            `// ${unique}_END`,
            '// ... existing code ...',
          ].join('\n'),
          useSmartModel: true,
        },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );

      if (!smartModelResult.success) {
        throw new Error(
          `Smart model edit failed: ${smartModelResult.error}. This test requires deterministic success.`,
        );
      }

      expect(smartModelResult.success).toBe(true);
      expect(smartModelResult.modelUsed).toBe('smart');
      expect(smartModelResult.appliedHunks).toBeGreaterThan(0);
      expect(smartModelResult.diff).toBeDefined();

      // Verify the content was actually changed
      const { output: readAfter } = await filesReadTool.invoke(
        { filesToRead: [{ filePath }] },
        { runtimeProvider: runtimeThreadProvider },
        RUNNABLE_CONFIG,
      );
      const contentAfter = readAfter.files?.[0]?.content || '';
      expect(contentAfter).toContain('Hi,');
      expect(contentAfter).not.toContain('Hello,');
    },
  );

  // NOTE: More detailed files_edit scenario coverage lives in unit tests.

  describe('files_read: line numbers and contentHash', () => {
    it(
      'returns numbered lines in NNN\\t format with startLine and contentHash',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/line-numbers-test.ts`;
        const content = 'first\nsecond\nthird';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(readResult.error).toBeUndefined();
        const file = readResult.files?.[0];
        expect(file).toBeDefined();
        expect(file!.content).toContain('1\tfirst');
        expect(file!.content).toContain('2\tsecond');
        expect(file!.content).toContain('3\tthird');
        expect(file!.startLine).toBe(1);
        expect(file!.contentHash).toBeDefined();
        expect(typeof file!.contentHash).toBe('string');
        expect(file!.contentHash!.length).toBe(8);
      },
    );

    it(
      'returns correct startLine and numbering for line-range reads',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/line-range-test.ts`;
        const content = Array.from(
          { length: 20 },
          (_, i) => `line${i + 1}`,
        ).join('\n');

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: readResult } = await filesReadTool.invoke(
          {
            filesToRead: [{ filePath, fromLineNumber: 5, toLineNumber: 8 }],
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(readResult.error).toBeUndefined();
        const file = readResult.files?.[0];
        expect(file).toBeDefined();
        expect(file!.startLine).toBe(5);
        expect(file!.content).toContain('5\tline5');
        expect(file!.content).toContain('8\tline8');
        expect(file!.content).not.toContain('4\t');
        expect(file!.content).not.toContain('9\t');
      },
    );
  });

  describe('files_apply_changes: insertAfterLine mode', () => {
    it(
      'inserts content after a specific line number',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/insert-after-line.ts`;
        const content = 'line1\nline2\nline3';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: insertResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: '',
            newText: 'inserted-line',
            insertAfterLine: 1,
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(insertResult.success).toBe(true);
        expect(insertResult.appliedEdits).toBe(1);
        expect(insertResult.postEditContext).toBeDefined();

        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const lines = (readResult.files?.[0]?.content || '')
          .split('\n')
          .map((l) => l.replace(/^\d+\t/, ''));
        expect(lines[0]).toBe('line1');
        expect(lines[1]).toBe('inserted-line');
        expect(lines[2]).toBe('line2');
        expect(lines[3]).toBe('line3');
      },
    );

    it(
      'inserts at the beginning when insertAfterLine is 0',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/insert-at-beginning.ts`;
        const content = 'existing-line';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: insertResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: '',
            newText: 'prepended-line',
            insertAfterLine: 0,
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(insertResult.success).toBe(true);

        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const lines = (readResult.files?.[0]?.content || '')
          .split('\n')
          .map((l) => l.replace(/^\d+\t/, ''));
        expect(lines[0]).toBe('prepended-line');
        expect(lines[1]).toBe('existing-line');
      },
    );

    it(
      'rejects insertAfterLine when oldText is non-empty',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/insert-invalid.ts`;

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: 'content' },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: result } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'non-empty',
            newText: 'replacement',
            insertAfterLine: 1,
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('oldText must be an empty string');
      },
    );
  });

  describe('files_apply_changes: expectedHash stale-read detection', () => {
    it(
      'accepts edit when hash matches current file',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/hash-match.ts`;
        const content = 'const x = 1;';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        // Read to get the hash
        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const hash = readResult.files?.[0]?.contentHash;
        expect(hash).toBeDefined();

        // Edit with correct hash
        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'const x = 1;',
            newText: 'const x = 2;',
            expectedHash: hash,
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(true);
      },
    );

    it(
      'rejects edit when hash does not match (stale read)',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/hash-stale.ts`;
        const content = 'const y = 1;';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        // Try to edit with a wrong hash
        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'const y = 1;',
            newText: 'const y = 2;',
            expectedHash: 'deadbeef',
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(false);
        expect(editResult.error).toContain('File has changed since last read');
      },
    );
  });

  describe('files_apply_changes: postEditContext in output', () => {
    it(
      'returns numbered postEditContext after a successful edit',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/post-edit-context.ts`;
        const content = Array.from(
          { length: 20 },
          (_, i) => `line${i + 1}`,
        ).join('\n');

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'line10',
            newText: 'REPLACED',
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(true);
        expect(editResult.postEditContext).toBeDefined();
        // Post-edit context should contain NNN\t format
        expect(editResult.postEditContext).toMatch(/\d+\t/);
        // Should contain the replaced line
        expect(editResult.postEditContext).toContain('REPLACED');
        // Should contain surrounding context
        expect(editResult.postEditContext).toContain('line9');
        expect(editResult.postEditContext).toContain('line11');
      },
    );
  });

  describe('files_apply_changes: progressive matching', () => {
    it(
      'matches with wrong indentation via trimmed fallback',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/trimmed-match.ts`;
        const content = '    const indented = true;\n    return indented;';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        // oldText has no indentation — exact match will fail, trimmed should succeed
        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'const indented = true;\nreturn indented;',
            newText: 'const indented = false;\nreturn indented;',
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(true);
        expect(editResult.matchStage).toBe('trimmed');

        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const afterContent = readResult.files?.[0]?.content || '';
        expect(afterContent).toContain('false');
        expect(afterContent).not.toContain('true');
      },
    );

    it(
      'matches with minor quote style difference via fuzzy fallback',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/fuzzy-match.ts`;
        const content = 'const msg = "hello world";';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        // oldText uses single quotes — fuzzy match should catch this
        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: "const msg = 'hello world';",
            newText: "const msg = 'goodbye world';",
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(true);
        expect(editResult.matchStage).toBe('fuzzy');

        const { output: readResult } = await filesReadTool.invoke(
          { filesToRead: [{ filePath }] },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const afterContent = readResult.files?.[0]?.content || '';
        expect(afterContent).toContain('goodbye');
      },
    );

    it(
      'reports matchStage as exact when oldText matches exactly',
      { timeout: INT_TEST_TIMEOUT },
      async () => {
        const filePath = `${WORKSPACE_DIR}/exact-match.ts`;
        const content = 'const val = 42;';

        await filesApplyChangesTool.invoke(
          { filePath, oldText: '', newText: content },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        const { output: editResult } = await filesApplyChangesTool.invoke(
          {
            filePath,
            oldText: 'const val = 42;',
            newText: 'const val = 99;',
          },
          { runtimeProvider: runtimeThreadProvider },
          RUNNABLE_CONFIG,
        );

        expect(editResult.success).toBe(true);
        expect(editResult.matchStage).toBe('exact');
      },
    );
  });
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
      await graphsService.destroy(contextDataStorage, graphId);
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
      await graphsService.delete(contextDataStorage, graphId);
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
      () => graphsService.findById(contextDataStorage, graphId),
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
      const graph = await graphsService.create(
        contextDataStorage,
        createFilesSearchGraphData(),
      );
      registerGraph(graph.id);

      await graphsService.run(contextDataStorage, graph.id);
      await waitForGraphStatus(graph.id, GraphStatus.Running, 30000);

      const execution = await graphsService.executeTrigger(
        contextDataStorage,
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
