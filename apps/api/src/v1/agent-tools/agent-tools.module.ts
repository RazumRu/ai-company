import { Module } from '@nestjs/common';

import { FilesBuildTagsTool } from './tools/common/files/files-build-tags.tool';
import { FilesListTool } from './tools/common/files/files-list.tool';
import { FilesReadTool } from './tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from './tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from './tools/common/files/files-search-text.tool';
import { FilesToolGroup } from './tools/common/files/files-tool-group';
import { GhBranchTool } from './tools/common/github/gh-branch.tool';
import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhCommitTool } from './tools/common/github/gh-commit.tool';
import { GhToolGroup } from './tools/common/github/gh-tool-group';
import { WebSearchTool } from './tools/common/web-search.tool';
import { CommunicationExecTool } from './tools/core/communication/communication-exec.tool';
import { CommunicationListTool } from './tools/core/communication/communication-list.tool';
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
    CommunicationListTool,
    CommunicationToolGroup,
    GhCloneTool,
    GhCommitTool,
    GhBranchTool,
    GhToolGroup,
    FilesListTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesToolGroup,
  ],
  exports: [
    ShellTool,
    WebSearchTool,
    FinishTool,
    CommunicationExecTool,
    CommunicationListTool,
    CommunicationToolGroup,
    GhCloneTool,
    GhCommitTool,
    GhBranchTool,
    GhToolGroup,
    FilesListTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesToolGroup,
  ],
})
export class AgentToolsModule {}
