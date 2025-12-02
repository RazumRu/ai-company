import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { z } from 'zod';

import { GhToolGroup } from '../../../agent-tools/tools/common/github/gh-tool-group';
import { IGithubResourceResourceOutput } from '../../../graph-resources/services/github-resource';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const GhToolTemplateSchema = z.object({}).strict();

@Injectable()
@RegisterTemplate()
export class GhToolTemplate extends ToolNodeBaseTemplate<
  typeof GhToolTemplateSchema
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

  async create(
    config: z.infer<typeof GhToolTemplateSchema>,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool[]> {
    // Find runtime node from output nodes
    const runtimeNodeIds = this.graphRegistry.filterNodesByType(
      metadata.graphId,
      outputNodeIds,
      NodeKind.Runtime,
    );

    if (runtimeNodeIds.length === 0) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node not found in output nodes`,
      );
    }

    const runtimeNode = this.graphRegistry.getNode<BaseRuntime>(
      metadata.graphId,
      runtimeNodeIds[0]!,
    );

    if (!runtimeNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node ${runtimeNodeIds[0]} not found`,
      );
    }

    // Collect resource node IDs from output nodes
    const resourceNodeIds = this.graphRegistry.filterNodesByTemplate(
      metadata.graphId,
      outputNodeIds,
      'github-resource',
    );

    const ghResourceId = resourceNodeIds[0];

    const ghResourceNode =
      this.graphRegistry.getNode<IGithubResourceResourceOutput>(
        metadata.graphId,
        ghResourceId || '',
      );

    if (!ghResourceNode) {
      throw new NotFoundException(
        'RESOURCE_NOT_FOUND',
        `No GitHub resource nodes found in output nodes`,
      );
    }

    const initScript = ghResourceNode.instance.data.initScript;
    const initScriptTimeout = ghResourceNode.instance.data.initScriptTimeout;
    const patToken = ghResourceNode?.instance.patToken;
    const resourceEnv = ghResourceNode.instance.data.env;

    if (initScript) {
      const res = await runtimeNode.instance.exec({
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

    // Store the runtime node ID to fetch fresh instance on each invocation
    const runtimeNodeId = runtimeNodeIds[0]!;
    const graphId = metadata.graphId;

    return this.ghToolGroup.buildTools({
      runtime: () => {
        // Get fresh runtime instance from registry on each invocation
        const currentRuntimeNode = this.graphRegistry.getNode<BaseRuntime>(
          graphId,
          runtimeNodeId,
        );

        if (!currentRuntimeNode) {
          throw new NotFoundException(
            'RUNTIME_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found in graph ${graphId}`,
          );
        }

        return currentRuntimeNode.instance;
      },
      patToken,
    });
  }
}
