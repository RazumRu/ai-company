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
      expect(all.length).toBeGreaterThanOrEqual(3);
    });

    it('should include explorer, simple, and smart agents', () => {
      const ids = service.getAllSystem().map((d) => d.id);
      expect(ids).toContain('system:explorer');
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

    it('should have maxContextTokens on explorer and simple, not on smart', () => {
      const explorer = service.getById('system:explorer');
      const simple = service.getById('system:simple');
      const smart = service.getById('system:smart');

      expect(explorer!.maxContextTokens).toBe(200_000);
      expect(simple!.maxContextTokens).toBe(70_000);
      expect(smart!.maxContextTokens).toBeUndefined();
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
