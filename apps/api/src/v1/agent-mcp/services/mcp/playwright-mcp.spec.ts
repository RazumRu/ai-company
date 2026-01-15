import { DefaultLogger } from '@packages/common';
import { describe, expect, it } from 'vitest';

import { PlaywrightMcp } from './playwright-mcp';

describe('PlaywrightMcp', () => {
  const createLogger = () =>
    new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });

  describe('getDetailedInstructions', () => {
    it('should generate detailed instructions', () => {
      const logger = createLogger();
      const playwrightMcp = new PlaywrightMcp(logger);

      const instructions = playwrightMcp.getDetailedInstructions({});

      expect(instructions).toContain('Playwright MCP');
    });

    it('should include best practices and workflows', () => {
      const logger = createLogger();
      const playwrightMcp = new PlaywrightMcp(logger);

      const instructions = playwrightMcp.getDetailedInstructions({});

      expect(instructions).toContain('Best Practices');
      expect(instructions).toContain('Common Workflows');
      expect(instructions).toContain('When to Use');
      expect(instructions).toContain('Security Considerations');
    });
  });
});
