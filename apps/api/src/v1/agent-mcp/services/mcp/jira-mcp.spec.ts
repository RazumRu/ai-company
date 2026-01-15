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
      jiraUrl: 'https://example.atlassian.net',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(config.name).toBe('jira');
    expect(config.command).toBe('docker');
    expect(config.args).toContain('run');
    expect(config.args).toContain('ghcr.io/sooperset/mcp-atlassian:latest');
    expect(config.env?.JIRA_URL).toBe('https://example.atlassian.net');
    expect(config.env?.JIRA_USERNAME).toBe('test@example.com');
    expect(config.env?.JIRA_API_TOKEN).toBe('test-key');
  });

  it('should include project key in config when provided', () => {
    const logger = new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });
    const jiraMcp = new JiraMcp(logger);

    const config = jiraMcp.getMcpConfig({
      projectKey: 'PROJ',
      jiraUrl: 'https://example.atlassian.net',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(config.env?.JIRA_PROJECTS_FILTER).toBe('PROJ');
  });

  it('should generate detailed instructions', () => {
    const logger = new DefaultLogger({
      environment: 'test',
      appName: 'test',
      appVersion: '1.0.0',
    });
    const jiraMcp = new JiraMcp(logger);

    const instructions = jiraMcp.getDetailedInstructions({
      jiraUrl: 'https://example.atlassian.net',
      jiraApiKey: 'test-key',
      jiraEmail: 'test@example.com',
    });

    expect(instructions).toContain('Jira MCP');
    expect(instructions).toContain('create_issue');
    expect(instructions).toContain('search_issues');
  });
});
