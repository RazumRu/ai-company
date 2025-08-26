import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import {
  Annotation,
  END,
  Messages,
  messagesStateReducer,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { environment } from '../../../environments';
import { PrepareRuntimeParams, RuntimeType } from '../../runtime/runtime.types';
import { RuntimeOrchestrator } from '../../runtime/services/runtime-orchestrator';
import { DeveloperAgent } from './agents/developer-agent';
import { ResearchAgent } from './agents/research-agent';

@Injectable()
export class AgentOrchestrator {
  constructor(private readonly runtimeOrchestrator: RuntimeOrchestrator) {}

  private getWorkdir(workdir?: string) {
    return workdir || '/workspace';
  }

  private async prepareRuntime(params?: PrepareRuntimeParams) {
    const runtime = this.runtimeOrchestrator.getRuntime(
      params?.runtimeType || RuntimeType.Docker,
      params?.runtimeImage || environment.dockerRuntimeImage,
    );

    await runtime.start({
      workdir: this.getWorkdir(params?.workdir),
    });

    try {
      if (params?.gitRepo) {
        if (params?.gitToken) {
          await runtime.exec({
            cmd: `
          git config --global credential.helper store

          # Extract hostname from the repo URL
          if [[ "$REPO_NAME" == http* ]]; then
            HOSTNAME=$(echo "$REPO_NAME" | sed -E 's|https?://([^/]+).*|\\1|')
          elif [[ "$REPO_NAME" == git@* ]]; then
            HOSTNAME=$(echo "$REPO_NAME" | sed -E 's|git@([^:]+):.*|\\1|')
          else
            # Default to github.com if we can't parse the hostname
            HOSTNAME="github.com"
          fi

          printf "https://%s@%s\\n" "$GH_TOKEN" "$HOSTNAME" >> ~/.git-credentials
          chmod 600 ~/.git-credentials`,
            env: {
              GH_TOKEN: params.gitToken,
              REPO_NAME: params.gitRepo,
            },
          });
        }

        await runtime.exec({
          cmd: `git clone $REPO_NAME`,
          env: {
            REPO_NAME: params?.gitRepo,
          },
        });
      }
    } finally {
      await runtime.stop();
    }

    return runtime;
  }

  public async buildAndRunDeveloperGraph(
    task: HumanMessage,
    params?: PrepareRuntimeParams,
  ) {
    const graphState = Annotation.Root({
      messages: Annotation<BaseMessage[], Messages>({
        reducer: messagesStateReducer,
      }),
      title: Annotation<string | undefined>({
        reducer: (_, y) => y,
      }),
      description: Annotation<string | undefined>({
        reducer: (_, y) => y,
      }),
      developerWorkSummary: Annotation<string | undefined>({
        reducer: (_, y) => y,
      }),
    });

    const runtime = await this.prepareRuntime(params);

    try {
      const researcher = new ResearchAgent(runtime);
      const researchFinalizer = new ResearchAgent(
        runtime,
        'Research Finalizer',
        'gpt-5-mini',
      );
      const developer = new DeveloperAgent(runtime);
      const developerFinalizer = new ResearchAgent(
        runtime,
        'Developer Finalizer',
        'gpt-5-mini',
      );

      const researchNode = async (
        state: typeof graphState.State,
      ): Promise<Partial<typeof graphState.State>> => {
        const res = await researcher.run(state.messages);

        const last = res.messages[res.messages.length - 1];

        return {
          messages: [
            new HumanMessage({
              content: last!.content,
              name: researcher.agentName,
            }),
          ],
        };
      };

      const researchFinalizeNode = async (
        state: typeof graphState.State,
      ): Promise<Partial<typeof graphState.State>> => {
        const schema = z.object({
          title: z.string(),
          description: z.string(),
          instructions: z.string(),
        });

        const res = await researchFinalizer.completeStructured(
          [
            new SystemMessage({
              content: `
            You are the Finalizer. Based on the prior Research Agent discussion, produce a valid JSON object that matches the provided schema.

            Guidelines:
            - \`title\`: a short, imperative task name (e.g. "Update login form validation").
            - \`description\`: 1–3 sentences that summarize the task for issue tracking (what and why, not how).
            - If information is missing, add explicit TODOs in \`instructions\`.`,
            }),
            ...state.messages,
          ],
          schema,
        );

        return {
          title: res.title,
          description: res.description,
        };
      };

      const developerNode = async (
        state: typeof graphState.State,
      ): Promise<Partial<typeof graphState.State>> => {
        const res = await developer.run([
          state.messages[state.messages.length - 1]!,
        ]);

        return { messages: res.messages };
      };

      const developerSummarizerNode = async (
        state: typeof graphState.State,
      ): Promise<Partial<typeof graphState.State>> => {
        const schema = z.object({
          workSummary: z.string(),
        });

        const res = await developerFinalizer.completeStructured(
          [
            new SystemMessage({
              content: `
            You are the Developer Work Summarizer. Based on the developer agent's work and messages, produce a valid JSON object that matches the provided schema.

            Guidelines:
            - \`workSummary\`: A concise summary of what the developer agent accomplished, including key actions taken, files modified, solutions implemented, or issues resolved.
            - Focus on concrete outcomes and deliverables rather than process details.
            - Keep the summary informative but brief (2-4 sentences).`,
            }),
            ...state.messages,
          ],
          schema,
        );

        return {
          developerWorkSummary: res.workSummary,
        };
      };

      const graph = new StateGraph(graphState)
        .addNode(researcher.agentName, researchNode)
        .addNode(researchFinalizer.agentName, researchFinalizeNode)
        .addNode(developer.agentName, developerNode)
        .addNode(developerFinalizer.agentName, developerSummarizerNode)
        .addEdge(START, researcher.agentName)
        .addEdge(researcher.agentName, researchFinalizer.agentName)
        .addEdge(researchFinalizer.agentName, developer.agentName)
        .addEdge(developer.agentName, developerFinalizer.agentName)
        .addEdge(developerFinalizer.agentName, END)
        .compile();

      return await graph.invoke({ messages: [task] });
    } finally {
      await runtime.stop();
    }
  }
}
