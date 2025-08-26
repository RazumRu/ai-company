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
import EventEmitter from 'events';
import { z } from 'zod';

import { environment } from '../../../environments';
import { RuntimeType } from '../../runtime/runtime.types';
import { RuntimeOrchestrator } from '../../runtime/services/runtime-orchestrator';
import {
  AgentEvent,
  AgentWorkflowEvent,
  AgentWorkflowOutput,
  PrepareRuntimeParams,
} from '../agents.types';
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
    } catch (e) {
      await runtime.stop();
      throw e;
    }

    return runtime;
  }

  public async buildAndRunDeveloperGraph(
    task: HumanMessage,
    runtimeParams?: PrepareRuntimeParams,
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
    type S = typeof graphState.State;

    const eventName = '__event__';
    const emitter = new EventEmitter();
    const emit = (data: AgentWorkflowEvent) => {
      emitter.emit(eventName, data);
    };

    emit({
      eventType: AgentEvent.PrepareRuntimeStart,
      eventName: 'Preparing runtime',
    });
    const runtime = await this.prepareRuntime(runtimeParams);
    emit({
      eventType: AgentEvent.PrepareRuntimeEnd,
      eventName: 'Finished preparing runtime',
    });

    try {
      const researcher = new ResearchAgent(runtime);
      const researchFinalizer = new ResearchAgent(
        runtime,
        'Research Finalizer',
        'gpt-5-mini',
      );

      const developer = new DeveloperAgent(runtime);
      const developerSchema = z.object({
        workSummary: z.string(),
      });
      developer.setSchema(developerSchema);

      const researchNode = async (state: S): Promise<Partial<S>> => {
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

      const researchFinalizeNode = async (state: S): Promise<Partial<S>> => {
        const schema = z.object({
          title: z.string(),
          description: z.string(),
        });

        const res = await researchFinalizer.completeStructured(
          [
            new SystemMessage({
              content: `
              You are the Finalizer. Based on the prior Research Agent discussion, produce a valid JSON object that matches the provided schema.

              Guidelines:
              - \`title\`: a short, imperative task name (e.g. "Update login form validation").
              - \`description\`: 1–3 sentences that summarize the task for issue tracking (what and why, not how).`,
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

      const developerNode = async (state: S): Promise<Partial<S>> => {
        const res = await developer.run<z.TypeOf<typeof developerSchema>>([
          state.messages[state.messages.length - 1]!,
          new SystemMessage({
            content: 'When you done - add your work summary',
          }),
        ]);

        return {
          messages: res.messages,
          developerWorkSummary: res.structuredResponse?.workSummary,
        };
      };

      const graph = new StateGraph(graphState)
        .addNode(researcher.agentName, researchNode)
        .addNode(researchFinalizer.agentName, researchFinalizeNode)
        .addNode(developer.agentName, developerNode)
        .addEdge(START, researcher.agentName)
        .addEdge(researcher.agentName, researchFinalizer.agentName)
        .addEdge(researchFinalizer.agentName, developer.agentName)
        .addEdge(developer.agentName, END)
        .compile();

      emit({
        eventType: AgentEvent.WorkflowStart,
        eventName: 'Workflow started',
      });

      const finalState = { messages: [task] };

      const stream = await graph.stream(finalState, {
        streamMode: ['updates'],
      });

      for await (const [mode, chunk] of stream) {
        if (mode === 'updates') {
          const state = Object.entries(chunk)[0]?.[1];

          if (state) {
            Object.assign(finalState, state);
          }
        }
      }

      emit({
        eventType: AgentEvent.WorkflowEnd,
        eventName: 'Workflow finished',
      });

      return {
        state: finalState as S,
        runtime,
        listener: (cb) => {
          emitter.on(eventName, cb);
        },
      } satisfies AgentWorkflowOutput<S>;
    } finally {
      await runtime.stop();
    }
  }
}
