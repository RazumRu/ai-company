import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesFindPathsTool } from './files-find-paths.tool';
import { FilesMoveFileTool } from './files-move-file.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTextTool } from './files-search-text.tool';
import { FilesToolGroup, FilesToolGroupConfig } from './files-tool-group';
import { FilesWriteFileTool } from './files-write-file.tool';

describe('FilesToolGroup', () => {
  let toolGroup: FilesToolGroup;
  let mockFilesFindPathsTool: FilesFindPathsTool;
  let mockFilesDirectoryTreeTool: FilesDirectoryTreeTool;
  let mockFilesReadTool: FilesReadTool;
  let mockFilesSearchTextTool: FilesSearchTextTool;
  let mockFilesCodebaseSearchTool: FilesCodebaseSearchTool;
  let mockFilesMoveFileTool: FilesMoveFileTool;
  let mockFilesWriteFileTool: FilesWriteFileTool;
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

    mockFilesCodebaseSearchTool = {
      build: vi.fn(),
    } as unknown as FilesCodebaseSearchTool;

    mockFilesMoveFileTool = {
      build: vi.fn(),
    } as unknown as FilesMoveFileTool;

    mockFilesWriteFileTool = {
      build: vi.fn(),
    } as unknown as FilesWriteFileTool;

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
          provide: FilesCodebaseSearchTool,
          useValue: mockFilesCodebaseSearchTool,
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
      const mockFilesCodebaseSearchToolInstance = {
        name: 'codebase_search',
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
      mockFilesCodebaseSearchTool.build = vi
        .fn()
        .mockReturnValue(mockFilesCodebaseSearchToolInstance);
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
        runtimeProvider: { provide: vi.fn() } as any,
      };

      const result = toolGroup.buildTools(config);

      expect(result).toBeDefined();
      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(9);
      expect(result.tools[0]).toBe(mockFilesFindPathsToolInstance);
      // Check that group instructions are returned
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe('string');
      expect(result.instructions).toContain('File tools workspace');
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
      expect(mockFilesCodebaseSearchTool.build).toHaveBeenCalledWith(
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
      const mockFilesCodebaseSearchToolInstance = {
        name: 'codebase_search',
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
      mockFilesCodebaseSearchTool.build = vi
        .fn()
        .mockReturnValue(mockFilesCodebaseSearchToolInstance);

      const config: FilesToolGroupConfig = {
        runtimeProvider: { provide: vi.fn() } as any,
        includeEditActions: false,
      };

      const result = toolGroup.buildTools(config);

      expect(result.tools.length).toBe(5);
      expect(result.tools[0]).toBe(mockFilesFindPathsToolInstance);
      // Check that group instructions are returned even in read-only mode
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe('string');
      expect(result.instructions).toContain('Read-only mode');
      expect(result.instructions).toContain('codebase_search');
      expect(mockFilesApplyChangesTool.build).not.toHaveBeenCalled();
      expect(mockFilesDeleteTool.build).not.toHaveBeenCalled();
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
      const mockFilesCodebaseSearchToolInstance = {
        name: 'codebase_search',
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
      mockFilesCodebaseSearchTool.build = vi
        .fn()
        .mockReturnValue(mockFilesCodebaseSearchToolInstance);
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
        runtimeProvider: { provide: vi.fn() } as any,
      };

      const result = toolGroup.buildTools(config, lgConfig);

      expect(result.tools.length).toBe(9);
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
      expect(mockFilesCodebaseSearchTool.build).toHaveBeenCalledWith(
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
        runtimeProvider: { provide: vi.fn() } as any,
        includeEditActions: true,
      };

      const result = toolGroup.getDetailedInstructions(config);

      expect(result).toBeDefined();
      expect(result).toContain('/runtime-workspace');
      expect(result).toContain('MANDATORY WORKFLOW');
      expect(result).toContain('files_apply_changes');
      expect(result).toContain('codebase_search');
      expect(result).toContain('multi-edit');
    });

    it('should return instructions for read-only mode', () => {
      const config: FilesToolGroupConfig = {
        runtimeProvider: { provide: vi.fn() } as any,
        includeEditActions: false,
      };

      const result = toolGroup.getDetailedInstructions(config);

      expect(result).toBeDefined();
      expect(result).toContain('/runtime-workspace');
      expect(result).toContain('Read-only mode');
      expect(result).not.toContain('files_apply_changes:');
      expect(result).toContain('codebase_search');
    });
  });
});
