import { Module } from '@nestjs/common';

import { CommunicationExecTool } from './tools/common/communication/communication-exec.tool';
import { CommunicationToolGroup } from './tools/common/communication/communication-tool-group';
import { FilesApplyChangesTool } from './tools/common/files/files-apply-changes.tool';
import { FilesBuildTagsTool } from './tools/common/files/files-build-tags.tool';
import { FilesCreateDirectoryTool } from './tools/common/files/files-create-directory.tool';
import { FilesDeleteTool } from './tools/common/files/files-delete.tool';
import { FilesDirectoryTreeTool } from './tools/common/files/files-directory-tree.tool';
import { FilesFindPathsTool } from './tools/common/files/files-find-paths.tool';
import { FilesMoveFileTool } from './tools/common/files/files-move-file.tool';
import { FilesReadTool } from './tools/common/files/files-read.tool';
import { FilesSearchTagsTool } from './tools/common/files/files-search-tags.tool';
import { FilesSearchTextTool } from './tools/common/files/files-search-text.tool';
import { FilesToolGroup } from './tools/common/files/files-tool-group';
import { FilesWriteFileTool } from './tools/common/files/files-write-file.tool';
import { GhBranchTool } from './tools/common/github/gh-branch.tool';
import { GhCloneTool } from './tools/common/github/gh-clone.tool';
import { GhCommitTool } from './tools/common/github/gh-commit.tool';
import { GhPushTool } from './tools/common/github/gh-push.tool';
import { GhToolGroup } from './tools/common/github/gh-tool-group';
import { ShellTool } from './tools/common/shell.tool';
import { WebSearchTool } from './tools/common/web-search.tool';
import { FinishTool } from './tools/core/finish.tool';

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
    FilesFindPathsTool,
    FilesDirectoryTreeTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesCreateDirectoryTool,
    FilesMoveFileTool,
    FilesWriteFileTool,
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
    FilesFindPathsTool,
    FilesDirectoryTreeTool,
    FilesReadTool,
    FilesSearchTextTool,
    FilesBuildTagsTool,
    FilesSearchTagsTool,
    FilesCreateDirectoryTool,
    FilesMoveFileTool,
    FilesWriteFileTool,
    FilesApplyChangesTool,
    FilesDeleteTool,
    FilesToolGroup,
  ],
})
export class AgentToolsModule {}
