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
        await runtime.exec({
          cmd: `
            mkdir -p ~/.ssh
            chmod 700 ~/.ssh
            ssh-keyscan github.com >> ~/.ssh/known_hosts
            chmod 644 ~/.ssh/known_hosts`,
          env: {
            REPO_NAME: params?.gitRepo,
          },
        });

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

        const repo = await runtime.exec({
          cmd: `git clone $REPO_NAME`,
          env: {
            REPO_NAME: params?.gitRepo,
          },
        });

        if (repo.fail) {
          throw new Error(`Failed to clone repo: ${repo.stderr}`);
        }
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
    listener?: (data: AgentWorkflowEvent) => Promise<void>,
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
    const finalState = { messages: [task] };

    const updateState = (newState: Partial<S>) => {
      return Object.assign(finalState, newState);
    };

    const emit = (data: AgentWorkflowEvent) => {
      listener?.(data);
    };

    emit({
      eventType: AgentEvent.PrepareRuntimeStart,
    });
    const runtime = await this.prepareRuntime(runtimeParams);
    emit({
      eventType: AgentEvent.PrepareRuntimeEnd,
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

        return updateState({
          messages: [
            new HumanMessage({
              content: last!.content,
              name: researcher.agentName,
            }),
          ],
        });
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

        return updateState({
          title: res.title,
          description: res.description,
        });
      };

      const developerNode = async (state: S): Promise<Partial<S>> => {
        const res = await developer.run<z.TypeOf<typeof developerSchema>>([
          state.messages[state.messages.length - 1]!,
          new SystemMessage({
            content: 'When you done - add your work summary',
          }),
        ]);

        const last = res.messages[res.messages.length - 1]!;

        return updateState({
          messages: [last],
          developerWorkSummary: res.structuredResponse?.workSummary,
        });
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
      });

      // Message buffer to accumulate chunks by run_id
      const messageBuffer = new Map<string, string>();

      const eventStream = graph.streamEvents(finalState, {
        version: 'v2',
        recursionLimit: 150,
      });

      // Process single event stream for both state updates and events
      for await (const event of eventStream) {
        const eventType = event.event;

        // Handle tool events
        if (eventType === 'on_tool_start') {
          emit({
            eventType: AgentEvent.ToolCallStart,
            agentName: event.metadata?.checkpoint_ns?.split(':')[0] || '',
            toolName: event.name,
            toolInput: JSON.parse(event.data?.input.input),
          });
        }
        // Handle agent messages from chat model streams - accumulate chunks
        else if (eventType === 'on_chat_model_stream') {
          const messageContent =
            event.data?.chunk?.message?.content || event.data?.chunk?.content;
          if (messageContent && event.run_id) {
            const currentBuffer = messageBuffer.get(event.run_id) || '';
            messageBuffer.set(event.run_id, currentBuffer + messageContent);
          }
        }
        // Handle chat model end - emit complete accumulated message
        else if (eventType === 'on_chat_model_end') {
          const runId = event.run_id;
          if (runId && messageBuffer.has(runId)) {
            const completeMessage = messageBuffer.get(runId);
            if (completeMessage && completeMessage.trim()) {
              emit({
                eventType: AgentEvent.Message,
                agentName: event.metadata?.checkpoint_ns?.split(':')[0] || '',
                messageContent: String(completeMessage).trim(),
              });
            }
            // Clean up the buffer
            messageBuffer.delete(runId);
          }
        }
      }

      emit({
        eventType: AgentEvent.WorkflowEnd,
      });

      return finalState as S;
    } finally {
      await runtime.stop();
    }
  }
}
