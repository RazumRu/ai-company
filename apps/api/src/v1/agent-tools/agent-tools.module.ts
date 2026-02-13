import { forwardRef, Module } from '@nestjs/common';

import { AgentsModule } from '../agents/agents.module';
import { GitRepositoriesModule } from '../git-repositories/git-repositories.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiModule } from '../openai/openai.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { SubagentsModule } from '../subagents/subagents.module';
import { CommunicationExecTool } from './tools/common/communication/communication-exec.tool';
import { CommunicationToolGroup } from './tools/common/communication/communication-tool-group';
import { FilesApplyChangesTool } from './tools/common/files/files-apply-changes.tool';
import { FilesCodebaseSearchTool } from './tools/common/files/files-codebase-search.tool';
import { FilesDeleteTool } from './tools/common/files/files-delete.tool';
import { FilesDirectoryTreeTool } from './tools/common/files/files-directory-tree.tool';
import { FilesFindPathsTool } from './tools/common/files/files-find-paths.tool';
import { FilesReadTool } from './tools/common/files/files-read.tool';
import { FilesSearchTextTool } from './tools/common/files/files-search-text.tool';
import { FilesToolGroup } from './tools/common/files/files-tool-group';
import { FilesWriteFileTool } from './tools/common/files/files-write-file.tool';
import { GhBranchTool } from './tools/common/github/gh-branch.tool';
import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhCommitTool } from './tools/common/github/gh-commit.tool';
import { GhCreatePullRequestTool } from './tools/common/github/gh-create-pull-request.tool';
import { GhPushTool } from './tools/common/github/gh-push.tool';
import { GhToolGroup } from './tools/common/github/gh-tool-group';
import { KnowledgeGetChunksTool } from './tools/common/knowledge/knowledge-get-chunks.tool';
import { KnowledgeGetDocTool } from './tools/common/knowledge/knowledge-get-doc.tool';
import { KnowledgeSearchChunksTool } from './tools/common/knowledge/knowledge-search-chunks.tool';
import { KnowledgeSearchDocsTool } from './tools/common/knowledge/knowledge-search-docs.tool';
import { KnowledgeToolGroup } from './tools/common/knowledge/knowledge-tool-group';
import { ShellTool } from './tools/common/shell.tool';
import { SubagentsListTool } from './tools/common/subagents/subagents-list.tool';
import { SubagentsRunTaskTool } from './tools/common/subagents/subagents-run-task.tool';
import { SubagentsToolGroup } from './tools/common/subagents/subagents-tool-group';
import { WebSearchTool } from './tools/common/web-search.tool';
import { FinishTool } from './tools/core/finish.tool';

@Module({
  imports: [
    GitRepositoriesModule,
    LitellmModule,
    OpenaiModule,
    KnowledgeModule,
    QdrantModule,
    SubagentsModule,
    forwardRef(() => AgentsModule),
  ],
  controllers: [],
  providers: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    CommunicationExecTool,
    CommunicationToolGroup,
    GhCloneTool,
    GhCommitTool,
    GhBranchTool,
    GhPushTool,
    GhCreatePullRequestTool,
    GhToolGroup,
    KnowledgeSearchDocsTool,
    KnowledgeSearchChunksTool,
    KnowledgeGetChunksTool,
    KnowledgeGetDocTool,
    KnowledgeToolGroup,
    FilesFindPathsTool,
    FilesDirectoryTreeTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesCodebaseSearchTool,
    FilesWriteFileTool,
    FilesApplyChangesTool,
    FilesDeleteTool,
    FilesToolGroup,
    SubagentsListTool,
    SubagentsRunTaskTool,
    SubagentsToolGroup,
  ],
  exports: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    CommunicationExecTool,
    CommunicationToolGroup,
    GhCloneTool,
    GhCommitTool,
    GhBranchTool,
    GhPushTool,
    GhCreatePullRequestTool,
    GhToolGroup,
    KnowledgeSearchDocsTool,
    KnowledgeSearchChunksTool,
    KnowledgeGetChunksTool,
    KnowledgeGetDocTool,
    KnowledgeToolGroup,
    FilesFindPathsTool,
    FilesDirectoryTreeTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesCodebaseSearchTool,
    FilesWriteFileTool,
    FilesApplyChangesTool,
    FilesDeleteTool,
    FilesToolGroup,
    SubagentsListTool,
    SubagentsRunTaskTool,
    SubagentsToolGroup,
  ],
})
export class AgentToolsModule {}
