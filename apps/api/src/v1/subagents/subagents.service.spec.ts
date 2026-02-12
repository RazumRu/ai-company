import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SubagentsService } from './subagents.service';

describe('SubagentsService', () => {
  let service: SubagentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubagentsService],
    }).compile();

    service = module.get<SubagentsService>(SubagentsService);
  });

  describe('getAllSystem', () => {
    it('should return all subagent definitions', () => {
      const all = service.getAllSystem();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('should include explorer and simple agents', () => {
      const ids = service.getAllSystem().map((d) => d.id);
      expect(ids).toContain('system:explorer');
      expect(ids).toContain('system:simple');
    });

    it('should include required fields on each definition', () => {
      for (const def of service.getAllSystem()) {
        expect(def.id).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.systemPrompt).toBeTruthy();
        expect(def.toolIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getById', () => {
    it('should return definition for known ID', () => {
      const explorer = service.getById('system:explorer');
      expect(explorer).toBeDefined();
      expect(explorer!.id).toBe('system:explorer');
    });

    it('should return undefined for unknown ID', () => {
      expect(service.getById('nonexistent')).toBeUndefined();
    });
  });
});
