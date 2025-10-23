import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { z } from 'zod';

import { ShellTool } from '../../../agent-tools/tools/shell.tool';
import {
  IBaseResourceOutput,
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const ShellToolTemplateSchema = z.object({}).strict();

@Injectable()
@RegisterTemplate()
export class ShellToolTemplate extends ToolNodeBaseTemplate<
  typeof ShellToolTemplateSchema
> {
  readonly name = 'shell-tool';
  readonly description = 'Execute shell commands in the selected runtime';
  readonly schema = ShellToolTemplateSchema;

  readonly inputs = [
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

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(private readonly shellTool: ShellTool) {
    super();
  }

  async create(
    config: z.infer<typeof ShellToolTemplateSchema>,
    inputNodes: Map<string, CompiledGraphNode>,
    _outputNodes: Map<string, CompiledGraphNode>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    // Find runtime node from input nodes
    let runtimeNode: CompiledGraphNode<BaseRuntime> | undefined;

    for (const [_nodeId, node] of inputNodes) {
      if (node.type === NodeKind.Runtime) {
        runtimeNode = node as CompiledGraphNode<BaseRuntime>;
        break;
      }
    }

    if (!runtimeNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node not found in input nodes`,
      );
    }

    // Collect resource nodes from input nodes
    const resourceNodeIds: string[] = [];

    for (const [nodeId, node] of inputNodes) {
      if (node.type === NodeKind.Resource) {
        resourceNodeIds.push(nodeId);
      }
    }

    // Discover and collect environment variables and information from resources
    const { env, information, initScripts } = this.collectResourceData(
      resourceNodeIds,
      inputNodes,
    );

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

    return this.shellTool.build({
      runtime: runtimeNode.instance,
      env,
      additionalInfo: information,
    });
  }

  private collectResourceData(
    resourceNodeIds: string[],
    connectedNodes: Map<string, CompiledGraphNode>,
  ): {
    env: Record<string, string>;
    information: string;
    initScripts: { cmd: string[] | string; timeout?: number }[];
  } {
    const envVars: Record<string, string> = {};
    const informationParts: string[] = [];
    const initScripts: { cmd: string[] | string; timeout?: number }[] = [];

    for (const nodeId of resourceNodeIds) {
      const node = connectedNodes.get(nodeId);
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
