import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';

import type { BaseRuntime } from '../../../runtime/services/base-runtime';
import { IMcpServerConfig } from '../../agent-mcp.types';
import { BaseMcp } from '../base-mcp';

export interface JiraMcpConfig {
  name: string;
  jiraApiKey: string;
  jiraEmail: string;
  projectKey?: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class JiraMcp extends BaseMcp<JiraMcpConfig> {
  private static readonly MCP_URL = 'https://mcp.atlassian.com/v1/sse';

  constructor(logger: DefaultLogger) {
    super(logger);
  }

  public override async setup(
    config: JiraMcpConfig,
    runtime: BaseRuntime,
  ): Promise<void> {
    // Fast, deterministic auth guard for integration tests (and user errors)
    if (!config.jiraApiKey?.trim()) {
      throw new Error('Jira MCP auth error: jiraApiKey is required');
    }
    if (!config.jiraEmail?.trim()) {
      throw new Error('Jira MCP auth error: jiraEmail is required');
    }

    await super.setup(config, runtime);
  }

  public getMcpConfig(config: JiraMcpConfig): IMcpServerConfig {
    return {
      name: config.name,
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        JiraMcp.MCP_URL,
        '--header',
        'Authorization: Bearer ${JIRA_API_KEY}',
      ],
      env: {
        JIRA_API_KEY: config.jiraApiKey,
        JIRA_EMAIL: config.jiraEmail,
        JIRA_PROJECT_KEY: config.projectKey || '',
      },
    };
  }

  public getDetailedInstructions(config: JiraMcpConfig): string {
    const projectFilter = config.projectKey
      ? `Filtered to project: ${config.projectKey}`
      : 'Access to all projects';

    return dedent`
      ### Jira MCP

      Integration with Jira for issue management and workflow automation.
      ${projectFilter}

      **Available Tools:**
      - \`create_issue\`: Create new Jira issues
      - \`update_issue\`: Update existing issues
      - \`search_issues\`: Search using JQL
      - \`get_issue\`: Get issue details
      - \`add_comment\`: Add comments to issues
      - \`transition_issue\`: Change issue status
      - \`get_transitions\`: List available status changes

      **When to Use:**
      - Creating or updating Jira issues
      - Searching for issues
      - Managing workflows
      - Adding comments

      **JQL Examples:**
      - \`project = PROJ AND status = "In Progress"\`
      - \`assignee = currentUser() AND resolution = Unresolved\`
      - \`created >= -7d\`

      **Common Workflows:**
      \`\`\`
      # Create and track
      create_issue({project: "PROJ", type: "Bug", summary: "..."})
      add_comment({key: "PROJ-123", body: "Investigating"})
      transition_issue({key: "PROJ-123", transitionId: "31"})

      # Search and update
      search_issues({jql: "project = PROJ AND status = 'To Do'"})
      get_transitions({key: "PROJ-456"})
      transition_issue({key: "PROJ-456", transitionId: "21"})
      \`\`\`
    `;
  }
}
