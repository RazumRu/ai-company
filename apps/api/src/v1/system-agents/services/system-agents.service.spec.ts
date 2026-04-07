import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SystemAgentsService } from './system-agents.service';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const ENGINEER_MD = `---
id: engineer
name: Engineer
description: A software engineer agent.
tools:
  - shell-tool
  - files-tool
---

You are a senior software engineer.
`;

const REVIEWER_MD = `---
id: reviewer
name: Reviewer
description: A code review agent.
tools:
  - files-tool
---

You are a code reviewer.
`;

const DUPLICATE_MD = `---
id: engineer
name: Engineer Duplicate
description: Another engineer.
tools: []
---

Duplicate.
`;

const mockLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
};

describe('SystemAgentsService', () => {
  let service: SystemAgentsService;

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemAgentsService,
        { provide: DefaultLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<SystemAgentsService>(SystemAgentsService);
  });

  describe('onModuleInit', () => {
    it('registers 0 agents when directory does not exist', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      service.onModuleInit();

      expect(service.getAll()).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('System agents directory not found'),
      );
    });

    it('loads valid .md files and registers definitions', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'engineer.md',
        'reviewer.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(ENGINEER_MD)
        .mockReturnValueOnce(REVIEWER_MD);

      service.onModuleInit();

      const definitions = service.getAll();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.id)).toContain('engineer');
      expect(definitions.map((d) => d.id)).toContain('reviewer');
    });

    it('skips non-.md files', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'engineer.md',
        'README.txt',
        '.gitkeep',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(ENGINEER_MD);

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
        expect.stringContaining('Skipping invalid system agent file'),
      );
    });

    it('throws on duplicate agent IDs to fail startup', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'engineer.md',
        'engineer2.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(ENGINEER_MD)
        .mockReturnValueOnce(DUPLICATE_MD);

      expect(() => service.onModuleInit()).toThrow(/Duplicate system agent id/);
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
        expect.stringContaining('Failed to read system agents directory'),
      );
    });

    it('skips file and logs warning when readFileSync throws, loads other valid files', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'engineer.md',
        'broken.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(ENGINEER_MD)
        .mockImplementationOnce(() => {
          throw new Error('EACCES: permission denied');
        });

      service.onModuleInit();

      const all = service.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe('engineer');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read system agent file'),
      );
    });
  });

  describe('getAll', () => {
    it('returns empty array when no agents loaded', async () => {
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
        'engineer.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(ENGINEER_MD);
      service.onModuleInit();
    });

    it('returns the definition for a known id', () => {
      const def = service.getById('engineer');
      expect(def.id).toBe('engineer');
      expect(def.name).toBe('Engineer');
      expect(def.templateId).toBe('system-agent-engineer');
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
        'engineer.md',
      ] as unknown as ReturnType<typeof readdirSync>);
      vi.mocked(readFileSync).mockReturnValue(ENGINEER_MD);
      service.onModuleInit();
    });

    it('returns the definition for a known templateId', () => {
      const def = service.getByTemplateId('system-agent-engineer');
      expect(def).toBeDefined();
      expect(def?.id).toBe('engineer');
    });

    it('returns undefined for an unknown templateId', () => {
      const def = service.getByTemplateId('system-agent-unknown');
      expect(def).toBeUndefined();
    });
  });
});
