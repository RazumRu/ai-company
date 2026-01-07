import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { ShellTool } from '../../../agent-tools/tools/common/shell.tool';
import {
  IBaseResourceOutput,
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

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

  public async create() {
    return {
      provide: async (
        _params: GraphNode<z.infer<typeof ShellToolTemplateSchema>>,
      ) => ({ tools: [] }),
      configure: async (
        params: GraphNode<z.infer<typeof ShellToolTemplateSchema>>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;

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

        const resourceNodeIds = this.graphRegistry.filterNodesByType(
          graphId,
          outputNodeIds,
          NodeKind.Resource,
        );

        const {
          env,
          information: resourcesInformation,
          initScripts,
        } = this.collectResourceData(resourceNodeIds, graphId);

        for (const script of initScripts) {
          const res = await runtime.exec({
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

        instance.tools.length = 0;
        instance.tools.push(
          this.shellTool.build({
            runtime,
            env,
            resourcesInformation,
          }),
        );
        instance.instructions = undefined; // No group instructions for single tool
      },
      destroy: async (instance: { tools: BuiltAgentTool[] }) => {
        instance.tools.length = 0;
      },
    };
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
        const inst = node.instance;
        if ((inst as IBaseResourceOutput)?.kind != ResourceKind.Shell) {
          continue;
        }

        const resourceOutput = inst as IShellResourceOutput;

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
