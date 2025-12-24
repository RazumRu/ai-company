import { DefaultLogger } from '@packages/common';
import { describe, expect, it } from 'vitest';

import { JiraMcp } from './jira-mcp';

describe('JiraMcp', () => {
  it('should return correct MCP server config', () => {
    const logger = new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });
    const jiraMcp = new JiraMcp(logger);

    const config = jiraMcp.getMcpConfig({
      name: 'jira',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(config.name).toBe('jira');
    expect(config.command).toBe('npx');
    expect(config.args).toContain('-y');
    expect(config.args).toContain('mcp-remote');
  });

  it('should include project key in config when provided', () => {
    const logger = new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });
    const jiraMcp = new JiraMcp(logger);

    const config = jiraMcp.getMcpConfig({
      name: 'jira',
      projectKey: 'PROJ',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(config.env?.JIRA_PROJECT_KEY).toBe('PROJ');
  });

  it('should generate detailed instructions', () => {
    const logger = new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });
    const jiraMcp = new JiraMcp(logger);

    const instructions = jiraMcp.getDetailedInstructions({
      name: 'jira',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(instructions).toContain('Jira MCP');
    expect(instructions).toContain('create_issue');
    expect(instructions).toContain('search_issues');
  });
});
