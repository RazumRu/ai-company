import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';

import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesBuildTagsTool } from './files-build-tags.tool';
import { FilesListTool } from './files-list.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTagsTool } from './files-search-tags.tool';
import { FilesSearchTextTool } from './files-search-text.tool';

export type FilesToolGroupConfig = FilesBaseToolConfig;

@Injectable()
export class FilesToolGroup extends BaseToolGroup<FilesToolGroupConfig> {
  constructor(
    private readonly filesListTool: FilesListTool,
    private readonly filesReadTool: FilesReadTool,
    private readonly filesSearchTextTool: FilesSearchTextTool,
    private readonly filesBuildTagsTool: FilesBuildTagsTool,
    private readonly filesSearchTagsTool: FilesSearchTagsTool,
  ) {
    super();
  }

  public buildTools(
    config: FilesToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [
      this.filesListTool.build(config, lgConfig),
      this.filesReadTool.build(config, lgConfig),
      this.filesSearchTextTool.build(config, lgConfig),
      this.filesBuildTagsTool.build(config, lgConfig),
      this.filesSearchTagsTool.build(config, lgConfig),
    ];

    return tools;
  }
}
