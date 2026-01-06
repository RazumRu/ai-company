import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import {
  GhToolGroup,
  GhToolType,
} from '../../../agent-tools/tools/common/github/gh-tool-group';
import { IGithubResourceOutput } from '../../../graph-resources/services/github-resource';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const GhToolTemplateSchema = z
  .object({
    cloneOnly: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'When true, expose only gh_clone; otherwise expose all GH tools',
      ),
  })
  // Strip legacy/unknown fields (e.g., includeClone/includeBranch/includeCommit)
  // so older configs remain valid without errors.
  .strip();

@Injectable()
@RegisterTemplate()
export class GhToolTemplate extends ToolNodeBaseTemplate<
  typeof GhToolTemplateSchema,
> {
  readonly id = 'gh-tool';
  readonly name = 'GitHub Tools';
  readonly description = 'GitHub tools';
  readonly schema = GhToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'template',
      value: 'github-resource',
      multiple: false,
      required: true,
    },
    {
      type: 'kind',
      value: NodeKind.Runtime,
      required: true,
      multiple: false,
    },
  ] as const;

  constructor(
    private readonly ghToolGroup: GhToolGroup,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<z.infer<typeof GhToolTemplateSchema>>,
      ) => [],
      configure: async (
        params: GraphNode<z.infer<typeof GhToolTemplateSchema>>,
        instance: BuiltAgentTool[],
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;
        const config = params.config;

        const runtimeNodeIds = this.graphRegistry.filterNodesByType(
          graphId,
          outputNodeIds,
          NodeKind.Runtime,
        );

        if (runtimeNodeIds.length === 0) {
          throw new NotFoundException(
            'NODE_NOT_FOUND',
            `Runtime node not found in output nodes`,
          );
        }

        const runtimeNodeId = runtimeNodeIds[0]!;
        const runtime = this.graphRegistry.getNodeInstance<BaseRuntime>(
          graphId,
          runtimeNodeId,
        );
        if (!runtime) {
          throw new NotFoundException(
            'NODE_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found`,
          );
        }

        const resourceNodeIds = this.graphRegistry.filterNodesByTemplate(
          graphId,
          outputNodeIds,
          'github-resource',
        );
        const ghResourceId = resourceNodeIds[0];

        const ghResourceNode =
          this.graphRegistry.getNode<IGithubResourceOutput>(
            graphId,
            ghResourceId || '',
          );

        if (!ghResourceNode) {
          throw new NotFoundException(
            'RESOURCE_NOT_FOUND',
            `No GitHub resource nodes found in output nodes`,
          );
        }

        const ghResource = ghResourceNode.instance;

        const initScript = ghResource.data.initScript;
        const initScriptTimeout = ghResource.data.initScriptTimeout;
        const patToken = ghResource.patToken;
        const resourceEnv = ghResource.data.env;

        if (initScript) {
          const res = await runtime.exec({
            cmd: initScript,
            timeoutMs: initScriptTimeout,
            env: resourceEnv,
          });

          if (res.fail) {
            throw new BadRequestException(
              'INIT_SCRIPT_EXECUTION_FAILED',
              `Init script execution failed: ${res.stderr}`,
              { cmd: initScript, ...res },
            );
          }
        }

        const parsedConfig = GhToolTemplateSchema.parse(config);
        const tools: GhToolType[] | undefined = parsedConfig.cloneOnly
          ? [GhToolType.CLONE]
          : undefined;

        instance.length = 0;
        instance.push(
          ...this.ghToolGroup.buildTools({
            runtime,
            patToken,
            tools,
          }),
        );
      },
      destroy: async (instance: BuiltAgentTool[]) => {
        instance.length = 0;
      },
    };
  }
}
