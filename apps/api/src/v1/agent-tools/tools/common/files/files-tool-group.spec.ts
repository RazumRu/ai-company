import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesBuildTagsTool } from './files-build-tags.tool';
import { FilesCreateDirectoryTool } from './files-create-directory.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesEditTool } from './files-edit.tool';
import { FilesFindPathsTool } from './files-find-paths.tool';
import { FilesMoveFileTool } from './files-move-file.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTagsTool } from './files-search-tags.tool';
import { FilesSearchTextTool } from './files-search-text.tool';
import { FilesToolGroup, FilesToolGroupConfig } from './files-tool-group';
import { FilesWriteFileTool } from './files-write-file.tool';

describe('FilesToolGroup', () => {
  let toolGroup: FilesToolGroup;
  let mockFilesFindPathsTool: FilesFindPathsTool;
  let mockFilesDirectoryTreeTool: FilesDirectoryTreeTool;
  let mockFilesReadTool: FilesReadTool;
  let mockFilesSearchTextTool: FilesSearchTextTool;
  let mockFilesBuildTagsTool: FilesBuildTagsTool;
  let mockFilesSearchTagsTool: FilesSearchTagsTool;
  let mockFilesCreateDirectoryTool: FilesCreateDirectoryTool;
  let mockFilesMoveFileTool: FilesMoveFileTool;
  let mockFilesWriteFileTool: FilesWriteFileTool;
  let mockFilesEditTool: FilesEditTool;
  let mockFilesApplyChangesTool: FilesApplyChangesTool;
  let mockFilesDeleteTool: FilesDeleteTool;

  beforeEach(async () => {
    mockFilesFindPathsTool = {
      build: vi.fn(),
    } as unknown as FilesFindPathsTool;

    mockFilesDirectoryTreeTool = {
      build: vi.fn(),
    } as unknown as FilesDirectoryTreeTool;

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

    mockFilesCreateDirectoryTool = {
      build: vi.fn(),
    } as unknown as FilesCreateDirectoryTool;

    mockFilesMoveFileTool = {
      build: vi.fn(),
    } as unknown as FilesMoveFileTool;

    mockFilesWriteFileTool = {
      build: vi.fn(),
    } as unknown as FilesWriteFileTool;

    mockFilesEditTool = {
      build: vi.fn(),
    } as unknown as FilesEditTool;

    mockFilesApplyChangesTool = {
      build: vi.fn(),
    } as unknown as FilesApplyChangesTool;

    mockFilesDeleteTool = {
      build: vi.fn(),
    } as unknown as FilesDeleteTool;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesToolGroup,
        {
          provide: FilesFindPathsTool,
          useValue: mockFilesFindPathsTool,
        },
        {
          provide: FilesDirectoryTreeTool,
          useValue: mockFilesDirectoryTreeTool,
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
          provide: FilesCreateDirectoryTool,
          useValue: mockFilesCreateDirectoryTool,
        },
        {
          provide: FilesMoveFileTool,
          useValue: mockFilesMoveFileTool,
        },
        {
          provide: FilesWriteFileTool,
          useValue: mockFilesWriteFileTool,
        },
        {
          provide: FilesEditTool,
          useValue: mockFilesEditTool,
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
    it('should build and return array with all tools when includeEditActions is true', () => {
      const mockFilesFindPathsToolInstance = {
        name: 'files_find_paths',
      } as DynamicStructuredTool;
      const mockFilesDirectoryTreeToolInstance = {
        name: 'files_directory_tree',
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
      const mockFilesCreateDirectoryToolInstance = {
        name: 'files_create_directory',
      } as DynamicStructuredTool;
      const mockFilesMoveFileToolInstance = {
        name: 'files_move_file',
      } as DynamicStructuredTool;
      const mockFilesWriteFileToolInstance = {
        name: 'files_write_file',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      mockFilesFindPathsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesFindPathsToolInstance);
      mockFilesDirectoryTreeTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDirectoryTreeToolInstance);
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
      mockFilesCreateDirectoryTool.build = vi
        .fn()
        .mockReturnValue(mockFilesCreateDirectoryToolInstance);
      mockFilesMoveFileTool.build = vi
        .fn()
        .mockReturnValue(mockFilesMoveFileToolInstance);
      mockFilesWriteFileTool.build = vi
        .fn()
        .mockReturnValue(mockFilesWriteFileToolInstance);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValue(mockFilesApplyChangesToolInstance);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDeleteToolInstance);

      const config: FilesToolGroupConfig = {
        runtime: {
          getWorkdir: () => '/test/workdir',
        } as any,
      };

      const result = toolGroup.buildTools(config);

      expect(result).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(12);
      expect(result.tools[0]).toBe(mockFilesFindPathsToolInstance);
      // Check that group instructions are returned
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe('string');
      expect(result.instructions).toContain('file system tools');
      expect(mockFilesFindPathsTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesDirectoryTreeTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
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
      expect(mockFilesCreateDirectoryTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesMoveFileTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesWriteFileTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config,
        undefined,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(config, undefined);
    });

    it('should omit edit tools when includeEditActions is false', () => {
      const mockFilesFindPathsToolInstance = {
        name: 'files_find_paths',
      } as DynamicStructuredTool;
      const mockFilesDirectoryTreeToolInstance = {
        name: 'files_directory_tree',
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

      mockFilesFindPathsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesFindPathsToolInstance);
      mockFilesDirectoryTreeTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDirectoryTreeToolInstance);
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

      const config: FilesToolGroupConfig = {
        runtime: {
          getWorkdir: () => '/test/workdir',
        } as any,
        includeEditActions: false,
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(6);
      expect(result.tools[0]).toBe(mockFilesFindPathsToolInstance);
      // Check that group instructions are returned even in read-only mode
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe('string');
      expect(result.instructions).toContain('(Read-only)');
      expect(result.instructions).toContain('edit actions disabled');
      expect(mockFilesApplyChangesTool.build).not.toHaveBeenCalled();
      expect(mockFilesDeleteTool.build).not.toHaveBeenCalled();
      expect(mockFilesCreateDirectoryTool.build).not.toHaveBeenCalled();
      expect(mockFilesMoveFileTool.build).not.toHaveBeenCalled();
      expect(mockFilesWriteFileTool.build).not.toHaveBeenCalled();
    });

    it('should pass lgConfig to tool build', () => {
      const mockFilesFindPathsToolInstance = {
        name: 'files_find_paths',
      } as DynamicStructuredTool;
      const mockFilesDirectoryTreeToolInstance = {
        name: 'files_directory_tree',
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
      const mockFilesCreateDirectoryToolInstance = {
        name: 'files_create_directory',
      } as DynamicStructuredTool;
      const mockFilesMoveFileToolInstance = {
        name: 'files_move_file',
      } as DynamicStructuredTool;
      const mockFilesWriteFileToolInstance = {
        name: 'files_write_file',
      } as DynamicStructuredTool;
      const mockFilesApplyChangesToolInstance = {
        name: 'files_apply_changes',
      } as DynamicStructuredTool;
      const mockFilesDeleteToolInstance = {
        name: 'files_delete',
      } as DynamicStructuredTool;
      const lgConfig = { description: 'Custom description' };
      mockFilesFindPathsTool.build = vi
        .fn()
        .mockReturnValue(mockFilesFindPathsToolInstance);
      mockFilesDirectoryTreeTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDirectoryTreeToolInstance);
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
      mockFilesCreateDirectoryTool.build = vi
        .fn()
        .mockReturnValue(mockFilesCreateDirectoryToolInstance);
      mockFilesMoveFileTool.build = vi
        .fn()
        .mockReturnValue(mockFilesMoveFileToolInstance);
      mockFilesWriteFileTool.build = vi
        .fn()
        .mockReturnValue(mockFilesWriteFileToolInstance);
      mockFilesApplyChangesTool.build = vi
        .fn()
        .mockReturnValue(mockFilesApplyChangesToolInstance);
      mockFilesDeleteTool.build = vi
        .fn()
        .mockReturnValue(mockFilesDeleteToolInstance);

      const config: FilesToolGroupConfig = {
        runtime: {
          getWorkdir: () => '/test/workdir',
        } as any,
      };

      const result = toolGroup.buildTools(config, lgConfig);

      expect(result.tools.length).toBe(12);
      expect(result.tools[0]).toBe(mockFilesFindPathsToolInstance);
      expect(mockFilesFindPathsTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesDirectoryTreeTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
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
      expect(mockFilesCreateDirectoryTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesMoveFileTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesWriteFileTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesApplyChangesTool.build).toHaveBeenCalledWith(
        config,
        lgConfig,
      );
      expect(mockFilesDeleteTool.build).toHaveBeenCalledWith(config, lgConfig);
    });

    // Note: additional coverage for different configs is redundant here; buildTools is pure and
    // simply delegates to each tool's build() with the given config.
  });

  describe('getDetailedInstructions', () => {
    it('should return instructions for full access mode', () => {
      const config: FilesToolGroupConfig = {
        runtime: {
          getWorkdir: () => '/test/repo/path',
        } as any,
        includeEditActions: true,
      };

      const result = toolGroup.getDetailedInstructions(config);

      expect(result).toBeDefined();
      expect(result).toContain('/test/repo/path');
      expect(result).toContain('Read/search + create/modify/move/delete');
      expect(result).toContain('files_apply_changes');
      expect(result).toContain('files_build_tags');
      expect(result).toContain('files_search_tags');
    });

    it('should return instructions for read-only mode', () => {
      const config: FilesToolGroupConfig = {
        runtime: {
          getWorkdir: () => '/test/repo/path',
        } as any,
        includeEditActions: false,
      };

      const result = toolGroup.getDetailedInstructions(config);

      expect(result).toBeDefined();
      expect(result).toContain('/test/repo/path');
      expect(result).toContain('(Read-only)');
      expect(result).toContain('edit actions disabled');
      expect(result).not.toContain('files_apply_changes');
      expect(result).toContain('files_build_tags');
    });
  });
});
