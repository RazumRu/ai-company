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
import { DockerRuntimeTemplateSchema } from '../runtimes/docker-runtime.template';

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

  constructor(private readonly shellTool: ShellTool) {
    super();
  }

  async create(
    config: z.infer<typeof ShellToolTemplateSchema>,
    _inputNodes: Map<string, CompiledGraphNode>,
    outputNodes: Map<string, CompiledGraphNode>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    // Find runtime node from output nodes
    let runtimeNode: CompiledGraphNode<BaseRuntime> | undefined;

    for (const [_nodeId, node] of outputNodes) {
      if (node.type === NodeKind.Runtime) {
        runtimeNode = node as CompiledGraphNode<BaseRuntime>;
        break;
      }
    }

    if (!runtimeNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node not found in output nodes`,
      );
    }

    // Collect resource nodes from output nodes
    const resourceNodeIds: string[] = [];

    for (const [nodeId, node] of outputNodes) {
      if (node.type === NodeKind.Resource) {
        resourceNodeIds.push(nodeId);
      }
    }

    // Discover and collect environment variables and information from resources
    const { env, information, initScripts } = this.collectResourceData(
      resourceNodeIds,
      outputNodes,
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

    // Collect runtime information from config
    const { information: runtimeInformation } = this.collectRuntimeData(
      runtimeNode,
      metadata,
    );

    // Combine resource information and runtime information
    const allInformationParts: string[] = [];
    if (runtimeInformation) {
      allInformationParts.push('Runtime Configuration:');
      allInformationParts.push(runtimeInformation);
    }
    if (information) {
      if (allInformationParts.length > 0) {
        allInformationParts.push('');
      }
      allInformationParts.push('Available Resources:');
      allInformationParts.push(information);
    }
    const combinedInfo = allInformationParts.join('\n');

    return this.shellTool.build({
      runtime: runtimeNode.instance,
      env,
      additionalInfo: combinedInfo,
    });
  }

  private collectRuntimeData(
    runtimeNode: CompiledGraphNode<BaseRuntime>,
    metadata: NodeBaseTemplateMetadata,
  ): {
    information: string;
  } {
    const runtimeInfoParts: string[] = [];

    // Check if runtime node has docker-runtime config
    if (runtimeNode.template === 'docker-runtime') {
      const runtimeConfig = runtimeNode.config as z.infer<
        typeof DockerRuntimeTemplateSchema
      >;

      if (runtimeConfig.image) {
        runtimeInfoParts.push(`- Docker Image: ${runtimeConfig.image}`);
      }
      if (runtimeConfig.workdir) {
        runtimeInfoParts.push(`- Working Directory: ${runtimeConfig.workdir}`);
      }
      runtimeInfoParts.push(
        `- Docker-in-Docker (DIND): ${runtimeConfig.enableDind ? 'Enabled' : 'Disabled'}`,
      );
      // Container name is generated from graphId and nodeId
      const containerName = `rt-${metadata.graphId}-${runtimeNode.id}`;
      runtimeInfoParts.push(`- Container Name: ${containerName}`);
    }

    return {
      information: runtimeInfoParts.join('\n'),
    };
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
