import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesApplyChangesTool } from '../../../v1/agent-tools/tools/common/files/files-apply-changes.tool';
import { FilesBuildTagsTool } from '../../../v1/agent-tools/tools/common/files/files-build-tags.tool';
import { FilesDeleteTool } from '../../../v1/agent-tools/tools/common/files/files-delete.tool';
import { FilesListTool } from '../../../v1/agent-tools/tools/common/files/files-list.tool';
import { FilesReadTool } from '../../../v1/agent-tools/tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from '../../../v1/agent-tools/tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from '../../../v1/agent-tools/tools/common/files/files-search-text.tool';
import { ShellTool } from '../../../v1/agent-tools/tools/core/shell.tool';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { RuntimeType } from '../../../v1/runtime/runtime.types';
import { BaseRuntime } from '../../../v1/runtime/services/base-runtime';
import { RuntimeProvider } from '../../../v1/runtime/services/runtime-provider';

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

type SearchTextResult = Awaited<ReturnType<FilesSearchTextTool['invoke']>>;
type SearchTagsResult = Awaited<ReturnType<FilesSearchTagsTool['invoke']>>;

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
  let filesListTool: FilesListTool;
  let filesReadTool: FilesReadTool;
  let filesSearchTextTool: FilesSearchTextTool;
  let filesApplyChangesTool: FilesApplyChangesTool;
  let filesBuildTagsTool: FilesBuildTagsTool;
  let filesSearchTagsTool: FilesSearchTagsTool;
  let filesDeleteTool: FilesDeleteTool;
  let shellTool: ShellTool;

  const writeSampleFile = async (fileName = 'sample.ts') => {
    const filePath = `${WORKSPACE_DIR}/${fileName}`;

    const result = await filesApplyChangesTool.invoke(
      {
        filePath,
        operation: 'replace',
        content: SAMPLE_TS_CONTENT,
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
        FilesListTool,
        FilesReadTool,
        FilesSearchTextTool,
        FilesApplyChangesTool,
        FilesBuildTagsTool,
        FilesSearchTagsTool,
        FilesDeleteTool,
        ShellTool,
        RuntimeProvider,
      ],
    }).compile();

    runtimeProvider = moduleRef.get(RuntimeProvider);
    filesListTool = moduleRef.get(FilesListTool);
    filesReadTool = moduleRef.get(FilesReadTool);
    filesSearchTextTool = moduleRef.get(FilesSearchTextTool);
    filesApplyChangesTool = moduleRef.get(FilesApplyChangesTool);
    filesBuildTagsTool = moduleRef.get(FilesBuildTagsTool);
    filesSearchTagsTool = moduleRef.get(FilesSearchTagsTool);
    filesDeleteTool = moduleRef.get(FilesDeleteTool);
    shellTool = moduleRef.get(ShellTool);

    runtime = await runtimeProvider.provide({
      type: RuntimeType.Docker,
      image: environment.dockerRuntimeImage,
      autostart: true,
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

      const insertResult = await filesApplyChangesTool.invoke(
        {
          filePath,
          operation: 'insert',
          startLine: 1,
          content: '// Integration header\n',
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(insertResult.success).toBe(true);

      const listResult = await filesListTool.invoke(
        { dir: WORKSPACE_DIR, pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files).toBeDefined();
      expect(listResult.files).toContain(filePath);

      const readResult = await filesReadTool.invoke(
        { filePath },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(readResult.error).toBeUndefined();
      expect(readResult.content?.startsWith('// Integration header')).toBe(
        true,
      );
      expect(readResult.content?.includes('export function greet')).toBe(true);

      const searchResult = await filesSearchTextTool.invoke(
        { filePath, query: 'HelperService' },
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

      const buildResult = await filesBuildTagsTool.invoke(
        { dir: WORKSPACE_DIR, alias: TAGS_ALIAS },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(buildResult.error).toBeUndefined();
      expect(buildResult.success).toBe(true);
      expect(buildResult.tagsFile).toBeDefined();
      expect(buildResult.tagsFile?.endsWith(`${TAGS_ALIAS}.json`)).toBe(true);

      const classSearch = await filesSearchTagsTool.invoke(
        {
          dir: WORKSPACE_DIR,
          alias: TAGS_ALIAS,
          query: 'HelperService',
          exactMatch: true,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(classSearch.error).toBeUndefined();
      expect(hasNamedTag(classSearch, 'HelperService')).toBe(true);

      const functionSearch = await filesSearchTagsTool.invoke(
        {
          dir: WORKSPACE_DIR,
          alias: TAGS_ALIAS,
          query: 'greet',
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

      const listResult = await filesListTool.invoke(
        { pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files?.some((f) => f.endsWith('cwd-file.ts'))).toBe(
        true,
      );

      const searchResult = await filesSearchTextTool.invoke(
        { filePath, query: 'HelperService' },
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
      const applyRes = await filesApplyChangesTool.invoke(
        {
          filePath,
          operation: 'replace',
          content,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(applyRes.success).toBe(true);

      // Move shell session into that directory and verify cwd
      const cdRes = await builtShell.invoke(
        { purpose: 'cd into custom dir', cmd: `cd ${customDir} && pwd` },
        RUNNABLE_CONFIG,
      );
      expect(cdRes.exitCode).toBe(0);
      expect(cdRes.stdout.trim()).toBe(customDir);

      // Use files_list without dir to rely on current session cwd
      const listRes = await filesListTool.invoke(
        { pattern: '*.txt' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listRes.error).toBeUndefined();
      const listedFile = listRes.files?.find((f) => f.endsWith('/note.txt'));
      expect(listedFile).toBe(filePath);
      expect(listedFile?.startsWith(customDir)).toBe(true);

      // Read the file from the custom directory
      const readRes = await filesReadTool.invoke(
        { filePath },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(readRes.error).toBeUndefined();
      expect(readRes.content?.trim()).toBe(content);
    },
  );

  it(
    'running tools with dir does not change persistent shell cwd',
    { timeout: INT_TEST_TIMEOUT },
    async () => {
      const builtShell = shellTool.build({ runtime });

      const setCwd = await builtShell.invoke(
        { purpose: 'set cwd', cmd: 'cd /tmp && pwd' },
        RUNNABLE_CONFIG,
      );
      expect(setCwd.exitCode).toBe(0);
      expect(setCwd.stdout.trim()).toBe('/tmp');

      // Run files_list with an explicit dir (subshell) and ensure cwd remains /tmp
      const listResult = await filesListTool.invoke(
        { dir: WORKSPACE_DIR, pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listResult.error).toBeUndefined();

      const cwdResult = await builtShell.invoke(
        { purpose: 'check cwd', cmd: 'pwd' },
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

      const createResult = await filesApplyChangesTool.invoke(
        {
          filePath,
          operation: 'replace',
          content,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      const listAfterCreate = await filesListTool.invoke(
        { dir: nestedDir, pattern: fileName },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listAfterCreate.error).toBeUndefined();
      expect(listAfterCreate.files).toContain(filePath);

      const deleteResult = await filesDeleteTool.invoke(
        { filePath },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(deleteResult.success).toBe(true);

      const listAfterDelete = await filesListTool.invoke(
        { dir: nestedDir, pattern: fileName },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listAfterDelete.error).toBeUndefined();
      expect(listAfterDelete.files?.includes(filePath)).toBe(false);
    },
  );
});
