import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesBuildTagsTool } from './files-build-tags.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesListTool } from './files-list.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTagsTool } from './files-search-tags.tool';
import { FilesSearchTextTool } from './files-search-text.tool';
import { FilesToolGroup, FilesToolGroupConfig } from './files-tool-group';

describe('FilesToolGroup', () => {
  let toolGroup: FilesToolGroup;
  let mockFilesListTool: FilesListTool;
  let mockFilesReadTool: FilesReadTool;
  let mockFilesSearchTextTool: FilesSearchTextTool;
  let mockFilesBuildTagsTool: FilesBuildTagsTool;
  let mockFilesSearchTagsTool: FilesSearchTagsTool;
  let mockFilesApplyChangesTool: FilesApplyChangesTool;
  let mockFilesDeleteTool: FilesDeleteTool;
  let mockConfig: FilesToolGroupConfig;

  beforeEach(async () => {
    mockFilesListTool = {
      build: vi.fn(),
    } as unknown as FilesListTool;

    mockFilesReadTool = {
      build: vi.fn(),
    } as unknown as FilesReadTool;

    mockFilesSearchTextTool = {
      build: vi.fn(),
    } as unknown as FilesSearchTextTool;

    mockFilesBuildTagsTool = {
      build: vi.fn(),
    } as unknown as FilesBuildTagsTool;

    mockFilesSearchTagsTool = {
      build: vi.fn(),
    } as unknown as FilesSearchTagsTool;

    mockFilesApplyChangesTool = {
      build: vi.fn(),
    } as unknown as FilesApplyChangesTool;

    mockFilesDeleteTool = {
      build: vi.fn(),
    } as unknown as FilesDeleteTool;

    mockConfig = {
      runtime: {} as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesToolGroup,
        {
          provide: FilesListTool,
          useValue: mockFilesListTool,
        },
        {
          provide: FilesReadTool,
          useValue: mockFilesReadTool,
        },
        {
          provide: FilesSearchTextTool,
          useValue: mockFilesSearchTextTool,
        },
        {
          provide: FilesBuildTagsTool,
          useValue: mockFilesBuildTagsTool,
        },
        {
          provide: FilesSearchTagsTool,
          useValue: mockFilesSearchTagsTool,
        },
        {
          provide: FilesApplyChangesTool,
          useValue: mockFilesApplyChangesTool,
        },
        {
          provide: FilesDeleteTool,
          useValue: mockFilesDeleteTool,
        },
      ],
    }).compile();

    toolGroup = module.get<FilesToolGroup>(FilesToolGroup);
  });

  describe('buildTools', () => {
    it('should build and return array with all seven tools', () => {
      const mockFilesListToolInstance = {
        name: 'files_list',
      } as DynamicStructuredTool;
      const mockFilesReadToolInstance = {
        name: 'files_read',
      } as DynamicStructuredTool;
      const mockFilesSearchTextToolInstance = {
        name: 'files_search_text',
      } as DynamicStructuredTool;
      const mockFilesBuildTagsToolInstance = {
        name: 'files_build_tags',
      } as DynamicStructuredTool;
      const mockFilesSearchTagsToolInstance = {
        name: 'files_search_tags',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      mockFilesListTool.build = vi
        .fn()
        .mockReturnValue(mockFilesListToolInstance);
      mockFilesReadTool.build = vi
        .fn()
        .mockReturnValue(mockFilesReadToolInstance);
      mockFilesSearchTextTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTextToolInstance);
      mockFilesBuildTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesBuildTagsToolInstance);
      mockFilesSearchTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTagsToolInstance);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValue(mockFilesApplyChangesToolInstance);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDeleteToolInstance);

      const config: FilesToolGroupConfig = {
        runtime: {} as any,
      };

      const result = toolGroup.buildTools(config);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(7);
      expect(result[0]).toBe(mockFilesListToolInstance);
      expect(result[1]).toBe(mockFilesReadToolInstance);
      expect(result[2]).toBe(mockFilesSearchTextToolInstance);
      expect(result[3]).toBe(mockFilesBuildTagsToolInstance);
      expect(result[4]).toBe(mockFilesSearchTagsToolInstance);
      expect(result[5]).toBe(mockFilesApplyChangesToolInstance);
      expect(result[6]).toBe(mockFilesDeleteToolInstance);
      expect(mockFilesListTool.build).toHaveBeenCalledWith(config, undefined);
      expect(mockFilesReadTool.build).toHaveBeenCalledWith(config, undefined);
      expect(mockFilesSearchTextTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesBuildTagsTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesSearchTagsTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(config, undefined);
    });

    it('should pass lgConfig to tool build', () => {
      const mockFilesListToolInstance = {
        name: 'files_list',
      } as DynamicStructuredTool;
      const mockFilesReadToolInstance = {
        name: 'files_read',
      } as DynamicStructuredTool;
      const mockFilesSearchTextToolInstance = {
        name: 'files_search_text',
      } as DynamicStructuredTool;
      const mockFilesBuildTagsToolInstance = {
        name: 'files_build_tags',
      } as DynamicStructuredTool;
      const mockFilesSearchTagsToolInstance = {
        name: 'files_search_tags',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      const lgConfig = { description: 'Custom description' };
      mockFilesListTool.build = vi
        .fn()
        .mockReturnValue(mockFilesListToolInstance);
      mockFilesReadTool.build = vi
        .fn()
        .mockReturnValue(mockFilesReadToolInstance);
      mockFilesSearchTextTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTextToolInstance);
      mockFilesBuildTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesBuildTagsToolInstance);
      mockFilesSearchTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTagsToolInstance);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValue(mockFilesApplyChangesToolInstance);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDeleteToolInstance);

      const config: FilesToolGroupConfig = {
        runtime: {} as any,
      };

      const result = toolGroup.buildTools(config, lgConfig);

      expect(result).toEqual([
        mockFilesListToolInstance,
        mockFilesReadToolInstance,
        mockFilesSearchTextToolInstance,
        mockFilesBuildTagsToolInstance,
        mockFilesSearchTagsToolInstance,
        mockFilesApplyChangesToolInstance,
        mockFilesDeleteToolInstance,
      ]);
      expect(mockFilesListTool.build).toHaveBeenCalledWith(config, lgConfig);
      expect(mockFilesReadTool.build).toHaveBeenCalledWith(config, lgConfig);
      expect(mockFilesSearchTextTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesBuildTagsTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesSearchTagsTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(config, lgConfig);
    });

    it('should handle different configs', () => {
      const mockFilesListToolInstance1 = {
        name: 'files_list',
      } as DynamicStructuredTool;
      const mockFilesReadToolInstance1 = {
        name: 'files_read',
      } as DynamicStructuredTool;
      const mockFilesSearchTextToolInstance1 = {
        name: 'files_search_text',
      } as DynamicStructuredTool;
      const mockFilesBuildTagsToolInstance1 = {
        name: 'files_build_tags',
      } as DynamicStructuredTool;
      const mockFilesSearchTagsToolInstance1 = {
        name: 'files_search_tags',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance1 = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance1 = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      const mockFilesListToolInstance2 = {
        name: 'files_list',
      } as DynamicStructuredTool;
      const mockFilesReadToolInstance2 = {
        name: 'files_read',
      } as DynamicStructuredTool;
      const mockFilesSearchTextToolInstance2 = {
        name: 'files_search_text',
      } as DynamicStructuredTool;
      const mockFilesBuildTagsToolInstance2 = {
        name: 'files_build_tags',
      } as DynamicStructuredTool;
      const mockFilesSearchTagsToolInstance2 = {
        name: 'files_search_tags',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance2 = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance2 = {
        name: 'files_delete',
      } as DynamicStructuredTool;

      mockFilesListTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesListToolInstance1)
        .mockReturnValueOnce(mockFilesListToolInstance2);
      mockFilesReadTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesReadToolInstance1)
        .mockReturnValueOnce(mockFilesReadToolInstance2);
      mockFilesSearchTextTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesSearchTextToolInstance1)
        .mockReturnValueOnce(mockFilesSearchTextToolInstance2);
      mockFilesBuildTagsTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesBuildTagsToolInstance1)
        .mockReturnValueOnce(mockFilesBuildTagsToolInstance2);
      mockFilesSearchTagsTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesSearchTagsToolInstance1)
        .mockReturnValueOnce(mockFilesSearchTagsToolInstance2);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesApplyChangesToolInstance1)
        .mockReturnValueOnce(mockFilesApplyChangesToolInstance2);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValueOnce(mockFilesDeleteToolInstance1)
        .mockReturnValueOnce(mockFilesDeleteToolInstance2);

      const config1: FilesToolGroupConfig = {
        runtime: {} as any,
      };
      const config2: FilesToolGroupConfig = {
        runtime: {} as any,
      };

      const result1 = toolGroup.buildTools(config1);
      const result2 = toolGroup.buildTools(config2);

      expect(result1[0]).toBe(mockFilesListToolInstance1);
      expect(result1[1]).toBe(mockFilesReadToolInstance1);
      expect(result1[2]).toBe(mockFilesSearchTextToolInstance1);
      expect(result1[3]).toBe(mockFilesBuildTagsToolInstance1);
      expect(result1[4]).toBe(mockFilesSearchTagsToolInstance1);
      expect(result1[5]).toBe(mockFilesApplyChangesToolInstance1);
      expect(result1[6]).toBe(mockFilesDeleteToolInstance1);
      expect(result2[0]).toBe(mockFilesListToolInstance2);
      expect(result2[1]).toBe(mockFilesReadToolInstance2);
      expect(result2[2]).toBe(mockFilesSearchTextToolInstance2);
      expect(result2[3]).toBe(mockFilesBuildTagsToolInstance2);
      expect(result2[4]).toBe(mockFilesSearchTagsToolInstance2);
      expect(result2[5]).toBe(mockFilesApplyChangesToolInstance2);
      expect(result2[6]).toBe(mockFilesDeleteToolInstance2);
      expect(mockFilesListTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesReadTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesSearchTextTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesBuildTagsTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesSearchTagsTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesDeleteTool.build).toHaveBeenCalledTimes(2);
      expect(mockFilesListTool.build).toHaveBeenCalledWith(config1, undefined);
      expect(mockFilesListTool.build).toHaveBeenCalledWith(config2, undefined);
      expect(mockFilesReadTool.build).toHaveBeenCalledWith(config1, undefined);
      expect(mockFilesReadTool.build).toHaveBeenCalledWith(config2, undefined);
      expect(mockFilesSearchTextTool.build).toHaveBeenCalledWith(
        config1,
        undefined,
      );
      expect(mockFilesSearchTextTool.build).toHaveBeenCalledWith(
        config2,
        undefined,
      );
      expect(mockFilesBuildTagsTool.build).toHaveBeenCalledWith(
        config1,
        undefined,
      );
      expect(mockFilesBuildTagsTool.build).toHaveBeenCalledWith(
        config2,
        undefined,
      );
      expect(mockFilesSearchTagsTool.build).toHaveBeenCalledWith(
        config1,
        undefined,
      );
      expect(mockFilesSearchTagsTool.build).toHaveBeenCalledWith(
        config2,
        undefined,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config1,
        undefined,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config2,
        undefined,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(
        config1,
        undefined,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(
        config2,
        undefined,
      );
    });

    it('should return array with all seven tools', () => {
      const mockFilesListToolInstance = {
        name: 'files_list',
      } as DynamicStructuredTool;
      const mockFilesReadToolInstance = {
        name: 'files_read',
      } as DynamicStructuredTool;
      const mockFilesSearchTextToolInstance = {
        name: 'files_search_text',
      } as DynamicStructuredTool;
      const mockFilesBuildTagsToolInstance = {
        name: 'files_build_tags',
      } as DynamicStructuredTool;
      const mockFilesSearchTagsToolInstance = {
        name: 'files_search_tags',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      mockFilesListTool.build = vi
        .fn()
        .mockReturnValue(mockFilesListToolInstance);
      mockFilesReadTool.build = vi
        .fn()
        .mockReturnValue(mockFilesReadToolInstance);
      mockFilesSearchTextTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTextToolInstance);
      mockFilesBuildTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesBuildTagsToolInstance);
      mockFilesSearchTagsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesSearchTagsToolInstance);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValue(mockFilesApplyChangesToolInstance);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDeleteToolInstance);

      const config: FilesToolGroupConfig = {
        runtime: {} as any,
      };

      const result = toolGroup.buildTools(config);

      expect(result.length).toBe(7);
      expect(result).toEqual([
        mockFilesListToolInstance,
        mockFilesReadToolInstance,
        mockFilesSearchTextToolInstance,
        mockFilesBuildTagsToolInstance,
        mockFilesSearchTagsToolInstance,
        mockFilesApplyChangesToolInstance,
        mockFilesDeleteToolInstance,
      ]);
    });
  });
});
