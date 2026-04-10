import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstructionBlocksService } from './instruction-blocks.service';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const CODING_GUIDELINES_MD = `---
id: coding-guidelines
name: Coding Guidelines
description: Standard coding guidelines for all projects.
---

Always write clean, readable code with descriptive variable names.
`;

const SECURITY_GUIDELINES_MD = `---
id: security-guidelines
name: Security Guidelines
description: Security best practices.
---

Never hardcode secrets. Always validate user input.
`;

const DUPLICATE_MD = `---
id: coding-guidelines
name: Coding Guidelines Duplicate
description: Another coding guidelines block.
---

Duplicate block.
`;

const mockLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
};

describe('InstructionBlocksService', () => {
  let service: InstructionBlocksService;

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructionBlocksService,
        { provide: DefaultLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<InstructionBlocksService>(InstructionBlocksService);
  });

  describe('onModuleInit', () => {
    it('registers 0 blocks when directory does not exist', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      service.onModuleInit();

      expect(service.getAll()).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instruction blocks directory not found'),
      );
    });

    it('loads valid .md files and registers definitions', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
        'security-guidelines.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(CODING_GUIDELINES_MD)
        .mockReturnValueOnce(SECURITY_GUIDELINES_MD);

      service.onModuleInit();

      const definitions = service.getAll();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.id)).toContain('coding-guidelines');
      expect(definitions.map((d) => d.id)).toContain('security-guidelines');
    });

    it('skips non-.md files', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
        'README.txt',
        '.gitkeep',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(CODING_GUIDELINES_MD);

      service.onModuleInit();

      expect(service.getAll()).toHaveLength(1);
    });

    it('skips files with invalid frontmatter (logs warning)', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'invalid.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(`---
name: Missing ID
---
Body.
`);

      service.onModuleInit();

      expect(service.getAll()).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping invalid instruction block file'),
      );
    });

    it('throws on duplicate block IDs to fail startup', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
        'coding-guidelines2.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(CODING_GUIDELINES_MD)
        .mockReturnValueOnce(DUPLICATE_MD);

      expect(() => service.onModuleInit()).toThrow(
        /Duplicate instruction block id/,
      );
    });

    it('returns [] and logs warning when readdirSync throws', async () => {
      const { existsSync, readdirSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      service.onModuleInit();

      expect(service.getAll()).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read instruction blocks directory'),
      );
    });

    it('skips file and logs warning when readFileSync throws, loads other valid files', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
        'broken.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(CODING_GUIDELINES_MD)
        .mockImplementationOnce(() => {
          throw new Error('EACCES: permission denied');
        });

      service.onModuleInit();

      const all = service.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe('coding-guidelines');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read instruction block file'),
      );
    });
  });

  describe('getAll', () => {
    it('returns empty array when no blocks loaded', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);
      service.onModuleInit();
      expect(service.getAll()).toEqual([]);
    });
  });

  describe('getById', () => {
    beforeEach(async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(CODING_GUIDELINES_MD);
      service.onModuleInit();
    });

    it('returns the definition for a known id', () => {
      const def = service.getById('coding-guidelines');
      expect(def.id).toBe('coding-guidelines');
      expect(def.name).toBe('Coding Guidelines');
      expect(def.templateId).toBe('instruction-block-coding-guidelines');
    });

    it('throws NotFoundException for unknown id', () => {
      expect(() => service.getById('unknown')).toThrow(NotFoundException);
    });
  });

  describe('getByTemplateId', () => {
    beforeEach(async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'coding-guidelines.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(CODING_GUIDELINES_MD);
      service.onModuleInit();
    });

    it('returns the definition for a known templateId', () => {
      const def = service.getByTemplateId(
        'instruction-block-coding-guidelines',
      );
      expect(def).toBeDefined();
      expect(def?.id).toBe('coding-guidelines');
    });

    it('returns undefined for an unknown templateId', () => {
      const def = service.getByTemplateId('instruction-block-unknown');
      expect(def).toBeUndefined();
    });
  });
});
