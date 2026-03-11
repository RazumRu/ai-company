import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import { execRuntimeWithContext } from '../../../agent-tools/agent-tools.utils';
import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { ShellTool } from '../../../agent-tools/tools/common/shell.tool';
import {
  IBaseResourceOutput,
  IShellResourceOutput,
  ResourceKind,
  ResourceResolveContext,
} from '../../../graph-resources/graph-resources.types';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
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
    let executorNodeId: string | undefined;

    return {
      provide: async (
        _params: GraphNode<z.infer<typeof ShellToolTemplateSchema>>,
      ) => ({ tools: [] as BuiltAgentTool[] }),
      configure: async (
        params: GraphNode<z.infer<typeof ShellToolTemplateSchema>>,
        instance: {
          tools: BuiltAgentTool[];
          runtimeProvider?: RuntimeThreadProvider;
        },
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
        const runtimeNode = this.graphRegistry.getNode<RuntimeThreadProvider>(
          graphId,
          runtimeNodeId,
        );

        if (!runtimeNode) {
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
          resolveEnvFns,
          information: resourcesInformation,
          initScripts,
        } = this.collectResourceData(resourceNodeIds, graphId);

        const initScriptList = initScripts.flatMap((script) =>
          Array.isArray(script.cmd) ? script.cmd : [script.cmd],
        );
        const initScriptTimeoutMs = Math.max(
          ...initScripts.map((script) => script.timeout ?? 0),
        );

        executorNodeId = params.metadata.nodeId;
        if (initScriptList.length > 0) {
          // resolveEnvFns is guaranteed non-empty here: init scripts only come
          // from shell resources, and every shell resource also provides a
          // resolveEnv function (see collectResourceData — both are pushed
          // together). So mergeResolvedEnvs is always called with at least
          // one function when initScriptList is non-empty.
          runtimeNode.instance.registerJob(
            executorNodeId,
            `shell-init:${executorNodeId}`,
            async (runtime, cfg) => {
              const env = await this.mergeResolvedEnvs(resolveEnvFns, cfg);
              for (const script of initScriptList) {
                const result = await execRuntimeWithContext(
                  runtime,
                  {
                    cmd: script,
                    timeoutMs: initScriptTimeoutMs || undefined,
                    env,
                  },
                  cfg,
                );
                if (result.fail) {
                  throw new Error(
                    `Shell init script failed (exit ${result.exitCode}): ${result.stderr}`,
                  );
                }
              }
            },
          );
        }
        instance.runtimeProvider = runtimeNode.instance;
        instance.tools.length = 0;

        // Combine all resource resolveEnv functions into one
        const resolveEnv =
          resolveEnvFns.length > 0
            ? (ctx?: ResourceResolveContext) =>
                this.mergeResolvedEnvs(resolveEnvFns, ctx)
            : undefined;

        instance.tools.push(
          this.shellTool.build({
            runtimeProvider: runtimeNode.instance,
            resourcesInformation,
            resolveEnv,
          }),
        );
      },
      destroy: async (instance: {
        tools: BuiltAgentTool[];
        runtimeProvider?: RuntimeThreadProvider;
      }) => {
        if (instance.runtimeProvider && executorNodeId) {
          instance.runtimeProvider.removeExecutor(executorNodeId);
        }
        instance.tools.length = 0;
      },
    };
  }

  private async mergeResolvedEnvs(
    fns: ((ctx?: ResourceResolveContext) => Promise<Record<string, string>>)[],
    ctx?: ResourceResolveContext,
  ): Promise<Record<string, string>> {
    const results = await Promise.all(fns.map((fn) => fn(ctx)));
    return Object.assign({}, ...results) as Record<string, string>;
  }

  private collectResourceData(
    resourceNodeIds: string[],
    graphId: string,
  ): {
    resolveEnvFns: ((
      ctx?: ResourceResolveContext,
    ) => Promise<Record<string, string>>)[];
    information: string;
    initScripts: { cmd: string[] | string; timeout?: number }[];
  } {
    const resolveEnvFns: ((
      ctx?: ResourceResolveContext,
    ) => Promise<Record<string, string>>)[] = [];
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

        resolveEnvFns.push(resourceOutput.data.resolveEnv);

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
      resolveEnvFns,
      information: informationParts.join('\n'),
      initScripts,
    };
  }
}
