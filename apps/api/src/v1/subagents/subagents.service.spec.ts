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
      expect(all.length).toBeGreaterThanOrEqual(4);
    });

    it('should include explorer, smart-explorer, simple, and smart agents', () => {
      const ids = service.getAllSystem().map((d) => d.id);
      expect(ids).toContain('system:explorer');
      expect(ids).toContain('system:smart-explorer');
      expect(ids).toContain('system:simple');
      expect(ids).toContain('system:smart');
    });

    it('should include required fields on each definition', () => {
      for (const def of service.getAllSystem()) {
        expect(def.id).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(typeof def.systemPrompt).toBe('function');
        expect(def.toolIds.length).toBeGreaterThan(0);
        expect(typeof def.model).toBe('function');
      }
    });

    it('should have maxContextTokens on explorer, smart-explorer, and simple, not on smart', () => {
      const explorer = service.getById('system:explorer');
      const smartExplorer = service.getById('system:smart-explorer');
      const simple = service.getById('system:simple');
      const smart = service.getById('system:smart');

      expect(explorer!.maxContextTokens).toBe(200_000);
      expect(smartExplorer!.maxContextTokens).toBe(200_000);
      expect(simple!.maxContextTokens).toBe(70_000);
      expect(smart!.maxContextTokens).toBeUndefined();
    });

    it('should give smart-explorer read-only tools', () => {
      const smartExplorer = service.getById('system:smart-explorer');

      expect(smartExplorer!.toolIds).toEqual(['shell:read-only', 'files:read-only']);
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
