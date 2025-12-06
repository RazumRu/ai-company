import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { ShellTool } from '../../../agent-tools/tools/core/shell.tool';
import {
  IBaseResourceOutput,
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const ShellToolTemplateSchema = z
  .object({})
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

@Injectable()
@RegisterTemplate()
export class ShellToolTemplate extends ToolNodeBaseTemplate<
  typeof ShellToolTemplateSchema
> {
  readonly id = 'shell-tool';
  readonly name = 'Shell';
  readonly description = 'Execute shell commands in the selected runtime';
  readonly schema = ShellToolTemplateSchema;

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
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Runtime,
      required: true,
      multiple: false,
    },
  ] as const;

  constructor(
    private readonly shellTool: ShellTool,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: z.infer<typeof ShellToolTemplateSchema>,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<BuiltAgentTool[]> {
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
    const resourceNodeIds = this.graphRegistry.filterNodesByType(
      metadata.graphId,
      outputNodeIds,
      NodeKind.Resource,
    );

    // Discover and collect environment variables and information from resources
    const {
      env,
      information: resourcesInformation,
      initScripts,
    } = this.collectResourceData(resourceNodeIds, metadata.graphId);

    // Execute init scripts on the runtime
    for (const script of initScripts) {
      const res = await runtimeNode.instance.exec({
        cmd: script.cmd,
        timeoutMs: script.timeout,
        env,
      });

      if (res.fail) {
        throw new BadRequestException(
          'INIT_SCRIPT_EXECUTION_FAILED',
          `Init script execution failed: ${res.stderr}`,
          { cmd: script.cmd, ...res },
        );
      }
    }

    // Store the runtime node ID to fetch fresh instance on each invocation
    const runtimeNodeId = runtimeNodeIds[0]!;
    const graphId = metadata.graphId;
    const builtTool = this.shellTool.build({
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
      env,
      resourcesInformation,
    });

    return [builtTool];
  }

  private collectResourceData(
    resourceNodeIds: string[],
    graphId: string,
  ): {
    env: Record<string, string>;
    information: string;
    initScripts: { cmd: string[] | string; timeout?: number }[];
  } {
    const envVars: Record<string, string> = {};
    const informationParts: string[] = [];
    const initScripts: { cmd: string[] | string; timeout?: number }[] = [];

    for (const nodeId of resourceNodeIds) {
      const node = this.graphRegistry.getNode<IShellResourceOutput>(
        graphId,
        nodeId,
      );

      if (node && node.type === NodeKind.Resource) {
        if ((<IBaseResourceOutput>node.instance)?.kind != ResourceKind.Shell) {
          continue;
        }

        const resourceOutput = node.instance as IShellResourceOutput;

        const resourceEnv = resourceOutput.data.env;
        if (resourceEnv) {
          Object.assign(envVars, resourceEnv);
        }

        // Collect information
        if (resourceOutput.information) {
          informationParts.push(
            `- ${node.template}: ${resourceOutput.information}`,
          );
        }

        // Collect init scripts
        const resourceInitScript = resourceOutput.data.initScript;
        if (resourceInitScript && resourceInitScript.length > 0) {
          initScripts.push({
            cmd: resourceInitScript,
            timeout: resourceOutput.data.initScriptTimeout,
          });
        }
      }
    }

    return {
      env: envVars,
      information: informationParts.join('\n'),
      initScripts,
    };
  }
}
