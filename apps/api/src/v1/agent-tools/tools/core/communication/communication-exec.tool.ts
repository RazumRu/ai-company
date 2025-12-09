import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { BaseCommunicationToolConfig } from './communication-tools.types';

export const CommunicationExecSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe(
      'The message to send to the target agent. Be clear and provide necessary context.',
    ),
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  agent: z
    .string()
    .min(1)
    .describe(
      'The name of the target agent. Must match one of the connected agents listed in the instructions.',
    ),
});

export type CommunicationExecSchemaType = z.infer<
  typeof CommunicationExecSchema
>;

@Injectable()
export class CommunicationExecTool extends BaseTool<
  CommunicationExecSchemaType,
  BaseCommunicationToolConfig
> {
  public name = 'communication_exec';
  public description =
    'Send a message to a specific agent. Connected agents are listed in the instructions.';

  protected override generateTitle(
    args: CommunicationExecSchemaType,
    _config: BaseCommunicationToolConfig,
  ): string {
    return `${args.purpose} → ${args.agent}`;
  }

  public getDetailedInstructions(
    config: BaseCommunicationToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);
    const availableAgents = config?.agents?.length
      ? config.agents
          .map((agent) => `####${agent.name}\n${agent.description}\n`)
          .join('\n')
      : '- No agents configured.';

    return dedent`
      ### Overview
      Sends a message to another agent in the system and returns their response. Enables multi-agent collaboration where different agents specialize in different tasks.

      ### Connected Agents
      ${availableAgents}

      ### When to Use
      - Delegating specialized tasks to expert agents
      - Getting a second opinion or review from another agent
      - Executing tasks that another agent is better suited for
      - Breaking down complex work across multiple agents

      ### When NOT to Use
      - You can handle the task yourself → work directly
      - You don't know which agent to use → pick from Connected Agents above
      - Task is too simple → direct execution is faster

      ${parameterDocs}

      ### \`message\` examples

      **Good messages:**
      \`\`\`json
      {
        "message": "Please review the changes in /repo/src/auth/login.ts and check for security vulnerabilities. Focus on input validation and token handling."
      }
      \`\`\`

      \`\`\`json
      {
        "message": "Implement unit tests for the UserService class located at /repo/src/services/user.service.ts. Cover the createUser and updateUser methods."
      }
      \`\`\`

      **Include:**
      - Clear task description
      - Relevant file paths or context
      - Specific focus areas or requirements
      - Expected output or deliverable

      ### Best Practices

      **1. Review connected agents:**
      Choose the most appropriate agent from the Connected Agents list above.

      **2. Provide complete context:**
      \`\`\`json
      {
        "agent": "test-writer",
        "message": "Write tests for the PaymentService class at /repo/src/services/payment.service.ts. The class handles credit card processing. Use Jest with TypeScript. Mock external payment API calls.",
        "purpose": "Generate unit tests for payment processing"
      }
      \`\`\`

      **3. Be specific about expectations:**
      \`\`\`json
      {
        "agent": "documenter",
        "message": "Generate JSDoc comments for all public methods in /repo/src/utils/validators.ts. Include parameter descriptions, return types, and usage examples.",
        "purpose": "Add API documentation"
      }
      \`\`\`

      **4. Handle responses appropriately:**
      The agent will return a response. Process it and continue your workflow.

      ### Output Format
      Returns the response from the target agent. Format varies by agent but typically includes their results, output, or completion status.

      ### Common Patterns

      **Delegate and continue:**
      \`\`\`
      1. Identify task that another agent handles better
      2. Call communication_exec with task details
      3. Process the response
      4. Continue with your workflow
      \`\`\`

      **Chain of agents:**
      \`\`\`
      1. Agent A starts work
      2. A delegates to Agent B for specialized task
      3. B returns results to A
      4. A integrates B's work and continues
      \`\`\`

      ### Error Handling
      - "Agent not found" → Check the name matches one of the connected agents
      - "No agents configured" → No agents are available for communication
      - Empty response → Agent may have failed or returned no output

      ### Integration with Workflows
      Use communication when:
      - A task falls outside your expertise
      - Parallel work is possible
      - Another agent has specific capabilities you lack
      - Complex tasks benefit from division of labor
    `;
  }

  public get schema() {
    return CommunicationExecSchema;
  }

  public async invoke(
    args: CommunicationExecSchemaType,
    config: BaseCommunicationToolConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<unknown>> {
    const title = this.generateTitle?.(args, config);

    if (!config?.agents || config.agents.length === 0) {
      throw new BadRequestException(
        undefined,
        'No agents configured for communication',
      );
    }

    const targetAgent = config.agents.find(
      (agent) => agent.name === args.agent,
    );

    if (!targetAgent) {
      throw new BadRequestException(
        undefined,
        `Agent "${args.agent}" not found. Check available connected agents in tool instructions.`,
      );
    }

    const output = await targetAgent.invokeAgent(
      [args.message],
      runnableConfig,
    );

    return {
      output,
      messageMetadata: { __title: title },
    };
  }
}
