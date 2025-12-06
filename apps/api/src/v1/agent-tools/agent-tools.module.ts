import { Module } from '@nestjs/common';

import { FilesApplyChangesTool } from './tools/common/files/files-apply-changes.tool';
import { FilesBuildTagsTool } from './tools/common/files/files-build-tags.tool';
import { FilesDeleteTool } from './tools/common/files/files-delete.tool';
import { FilesListTool } from './tools/common/files/files-list.tool';
import { FilesReadTool } from './tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from './tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from './tools/common/files/files-search-text.tool';
import { FilesToolGroup } from './tools/common/files/files-tool-group';
import { GhBranchTool } from './tools/common/github/gh-branch.tool';
import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhCommitTool } from './tools/common/github/gh-commit.tool';
import { GhPushTool } from './tools/common/github/gh-push.tool';
import { GhToolGroup } from './tools/common/github/gh-tool-group';
import { WebSearchTool } from './tools/common/web-search.tool';
import { CommunicationExecTool } from './tools/core/communication/communication-exec.tool';
import { CommunicationToolGroup } from './tools/core/communication/communication-tool-group';
import { FinishTool } from './tools/core/finish.tool';
import { ShellTool } from './tools/core/shell.tool';

@Module({
  imports: [],
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
    GhToolGroup,
    FilesListTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesApplyChangesTool,
    FilesDeleteTool,
    FilesToolGroup,
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
    GhToolGroup,
    FilesListTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesApplyChangesTool,
    FilesDeleteTool,
    FilesToolGroup,
  ],
})
export class AgentToolsModule {}
