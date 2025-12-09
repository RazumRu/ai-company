import { ToolRunnableConfig } from '@langchain/core/tools';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BaseException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { environment } from '../../../environments';
import { FilesApplyChangesTool } from '../../../v1/agent-tools/tools/common/files/files-apply-changes.tool';
import { FilesBuildTagsTool } from '../../../v1/agent-tools/tools/common/files/files-build-tags.tool';
import { FilesDeleteTool } from '../../../v1/agent-tools/tools/common/files/files-delete.tool';
import { FilesListTool } from '../../../v1/agent-tools/tools/common/files/files-list.tool';
import { FilesReadTool } from '../../../v1/agent-tools/tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from '../../../v1/agent-tools/tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from '../../../v1/agent-tools/tools/common/files/files-search-text.tool';
import { ShellTool } from '../../../v1/agent-tools/tools/core/shell.tool';
import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../v1/agents/services/nodes/base-node';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
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

    const { output: result } = await filesApplyChangesTool.invoke(
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

      const { output: insertResult } = await filesApplyChangesTool.invoke(
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

      const { output: listResult } = await filesListTool.invoke(
        { dir: WORKSPACE_DIR, pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files).toBeDefined();
      expect(listResult.files).toContain(filePath);

      const { output: readResult } = await filesReadTool.invoke(
        { filePath },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(readResult.error).toBeUndefined();
      expect(readResult.content?.startsWith('// Integration header')).toBe(
        true,
      );
      expect(readResult.content?.includes('export function greet')).toBe(true);

      const { output: searchResult } = await filesSearchTextTool.invoke(
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

      const { output: buildResult } = await filesBuildTagsTool.invoke(
        { dir: WORKSPACE_DIR, alias: TAGS_ALIAS },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(buildResult.error).toBeUndefined();
      expect(buildResult.success).toBe(true);
      expect(buildResult.tagsFile).toBeDefined();
      expect(buildResult.tagsFile?.endsWith(`${TAGS_ALIAS}.json`)).toBe(true);

      const { output: classSearch } = await filesSearchTagsTool.invoke(
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

      const { output: functionSearch } = await filesSearchTagsTool.invoke(
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

      const { output: listResult } = await filesListTool.invoke(
        { pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listResult.error).toBeUndefined();
      expect(listResult.files?.some((f) => f.endsWith('cwd-file.ts'))).toBe(
        true,
      );

      const { output: searchResult } = await filesSearchTextTool.invoke(
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
      const { output: applyRes } = await filesApplyChangesTool.invoke(
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
      const { output: cdRes } = await builtShell.invoke(
        { purpose: 'cd into custom dir', cmd: `cd ${customDir} && pwd` },
        RUNNABLE_CONFIG,
      );
      expect(cdRes.exitCode).toBe(0);
      expect(cdRes.stdout.trim()).toBe(customDir);

      // Use files_list without dir to rely on current session cwd
      const { output: listRes } = await filesListTool.invoke(
        { pattern: '*.txt' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listRes.error).toBeUndefined();
      const listedFile = listRes.files?.find((f) => f.endsWith('/note.txt'));
      expect(listedFile).toBe(filePath);
      expect(listedFile?.startsWith(customDir)).toBe(true);

      // Read the file from the custom directory
      const { output: readRes } = await filesReadTool.invoke(
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

      const { output: setCwd } = await builtShell.invoke(
        { purpose: 'set cwd', cmd: 'cd /tmp && pwd' },
        RUNNABLE_CONFIG,
      );
      expect(setCwd.exitCode).toBe(0);
      expect(setCwd.stdout.trim()).toBe('/tmp');

      // Run files_list with an explicit dir (subshell) and ensure cwd remains /tmp
      const { output: listResult } = await filesListTool.invoke(
        { dir: WORKSPACE_DIR, pattern: '*.ts' },
        { runtime },
        RUNNABLE_CONFIG,
      );
      expect(listResult.error).toBeUndefined();

      const { output: cwdResult } = await builtShell.invoke(
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

      const { output: createResult } = await filesApplyChangesTool.invoke(
        {
          filePath,
          operation: 'replace',
          content,
        },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(createResult.success).toBe(true);

      const { output: listAfterCreate } = await filesListTool.invoke(
        { dir: nestedDir, pattern: fileName },
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

      const { output: listAfterDelete } = await filesListTool.invoke(
        { dir: nestedDir, pattern: fileName },
        { runtime },
        RUNNABLE_CONFIG,
      );

      expect(listAfterDelete.error).toBeUndefined();
      expect(listAfterDelete.files?.includes(filePath)).toBe(false);
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
