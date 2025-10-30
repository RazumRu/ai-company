import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IBaseResourceOutput, ResourceKind } from '../graph-resources.types';
import { BaseResource } from './base-resource';

// Test implementation of BaseResource
class TestResource extends BaseResource<
  { testParam: string },
  IBaseResourceOutput<{ testData: string }>
> {
  public kind = ResourceKind.Shell;

  public async getData(config: {
    testParam: string;
  }): Promise<IBaseResourceOutput<{ testData: string }>> {
    return {
      information: `Test resource with param: ${config.testParam}`,
      kind: ResourceKind.Shell,
      data: {
        testData: `processed_${config.testParam}`,
      },
    };
  }
}

class TestResourceWithSetup extends BaseResource<
  { setupParam: string },
  IBaseResourceOutput<{ setupData: string }>
> {
  public kind = ResourceKind.Shell;

  public async setup(config: { setupParam: string }): Promise<void> {
    // Mock setup logic
    this.logger?.log(`Setting up resource with param: ${config.setupParam}`);
  }

  public async getData(config: {
    setupParam: string;
  }): Promise<IBaseResourceOutput<{ setupData: string }>> {
    return {
      information: `Setup resource with param: ${config.setupParam}`,
      kind: ResourceKind.Shell,
      data: {
        setupData: `setup_${config.setupParam}`,
      },
    };
  }
}

describe('BaseResource', () => {
  let testResource: TestResource;
  let testResourceWithSetup: TestResourceWithSetup;
  let mockLogger: DefaultLogger;

  beforeEach(async () => {
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    } as unknown as DefaultLogger;

    const _module: TestingModule = await Test.createTestingModule({
      providers: [
        TestResource,
        TestResourceWithSetup,
        {
          provide: DefaultLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    testResource = new TestResource(mockLogger);
    testResourceWithSetup = new TestResourceWithSetup(mockLogger);
  });

  describe('constructor', () => {
    it('should accept optional logger', () => {
      expect(testResource).toBeDefined();
      expect(testResourceWithSetup).toBeDefined();
    });
  });

  describe('kind property', () => {
    it('should be defined by subclasses', () => {
      expect(testResource.kind).toBe(ResourceKind.Shell);
      expect(testResourceWithSetup.kind).toBe(ResourceKind.Shell);
    });
  });

  describe('getData', () => {
    it('should be implemented by subclasses', async () => {
      const config = { testParam: 'test_value' };
      const result = await testResource.getData(config);

      expect(result).toEqual({
        information: 'Test resource with param: test_value',
        kind: ResourceKind.Shell,
        data: {
          testData: 'processed_test_value',
        },
      });
    });

    it('should return proper IBaseResourceOutput structure', async () => {
      const config = { testParam: 'another_value' };
      const result = await testResource.getData(config);

      expect(result).toHaveProperty('information');
      expect(result).toHaveProperty('data');
      expect(typeof result.information).toBe('string');
      expect(typeof result.data).toBe('object');
    });
  });

  describe('setup', () => {
    it('should be optional and not throw when not implemented', async () => {
      const config = { testParam: 'test_value' };

      // Should not throw even though setup is not implemented
      expect(async () => {
        if (testResource.setup) {
          await testResource.setup(config);
        }
      }).not.toThrow();
    });

    it('should be callable when implemented', async () => {
      const config = { setupParam: 'setup_value' };

      if (testResourceWithSetup.setup) {
        await testResourceWithSetup.setup(config);

        expect(mockLogger.log).toHaveBeenCalledWith(
          'Setting up resource with param: setup_value',
        );
      }
    });

    it('should work with getData after setup', async () => {
      const config = { setupParam: 'setup_value' };

      if (testResourceWithSetup.setup) {
        await testResourceWithSetup.setup(config);
      }

      const result = await testResourceWithSetup.getData(config);

      expect(result).toEqual({
        information: 'Setup resource with param: setup_value',
        kind: ResourceKind.Shell,
        data: {
          setupData: 'setup_setup_value',
        },
      });
    });
  });

  describe('abstract methods', () => {
    it('should require kind to be defined', () => {
      expect(testResource.kind).toBeDefined();
      expect(testResourceWithSetup.kind).toBeDefined();
    });

    it('should require getData to be implemented', () => {
      expect(typeof testResource.getData).toBe('function');
      expect(typeof testResourceWithSetup.getData).toBe('function');
    });
  });
});
