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

import { environment } from '../../environments';
import { PrepareRuntimeParams } from '../agents/agents.types';
import { RuntimeType } from '../runtime/runtime.types';
import { RuntimeOrchestrator } from '../runtime/services/runtime-orchestrator';
import { DeveloperAgent } from './developer-agent';
import { ResearchAgent } from './research-agent';

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

    return runtime;
  }

  public async build(task: HumanMessage, runtimeParams?: PrepareRuntimeParams) {
    const runtime = await this.prepareRuntime(runtimeParams);

    try {
    } finally {
      await runtime.stop();
    }
  }
}
