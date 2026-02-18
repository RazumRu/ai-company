import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  BaseException,
  InternalException,
  NotFoundException,
} from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { isPlainObject, isString } from 'lodash';
import type { UnknownRecord } from 'type-fest';
import { z } from 'zod';

import { BaseMcp } from '../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { ToolNodeOutput } from '../../graph-templates/templates/base-node.template';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { MessageDto } from '../../graphs/dto/graphs.dto';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import {
  CompiledGraph,
  GraphEdgeSchemaType,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphCompiler } from '../../graphs/services/graph-compiler';

import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import {
  CompleteData,
  CompleteJsonData,
  OpenaiService,
  ResponseData,
  ResponseJsonData,
} from '../../openai/openai.service';
import { MessagesDao } from '../../threads/dao/messages.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import {
  KnowledgeContentSuggestionRequest,
  KnowledgeContentSuggestionResponse,
  SuggestAgentInstructionsDto,
  SuggestAgentInstructionsResponse,
  SuggestGraphInstructionsRequest,
  SuggestGraphInstructionsResponse,
  ThreadAnalysisRequestDto,
  ThreadAnalysisResponse,
} from '../dto/ai-suggestions.dto';

type SanitizedMessage =
  | {
      role: 'human' | 'ai' | 'reasoning' | 'system';
      content: string;
      from: string;
      toolCalls?: {
        name: string;
        args?: Record<string, unknown>;
        type?: string;
      }[];
    }
  | {
      role: 'tool';
      name: string;
      content: string;
      from: string;
      title?: string;
    };

type AgentContext = {
  nodeId: string;
  template: string;
  name?: string;
  description?: string;
  instructions: string;
};

type ConnectedToolInfo = {
  name: string;
  description: string;
  instructions?: string;
};

/**
 * Best practices for writing/improving agent system instructions.
 * Appended to the LLM system message when suggesting instruction changes
 * so the model applies proven prompt-engineering patterns.
 */
const INSTRUCTION_BEST_PRACTICES = [
  '',
  '<instruction_quality_guidelines>',
  'When rewriting instructions, apply these prompt-engineering best practices:',
  '',
  'Structure:',
  '- Use XML tags (e.g. <role>, <tools>, <workflow>, <guardrails>, <examples>) to separate concerns. This prevents the model from conflating instructions with context or examples.',
  '- Keep role definitions rich and specific — include specialization, experience level, and behavioral traits. Deeper role context yields better performance on complex tasks.',
  '- Use consistent tag names throughout; refer to tags by name when directing the model.',
  '- Nest tags for hierarchical content.',
  '',
  'Writing style:',
  '- Prefer positive instructions over negatives. Instead of "Do NOT re-read files", write "Trust the upstream analysis and proceed directly. Only re-read a file if an edit fails."',
  '- Provide context/motivation for important rules so the model understands *why* and can generalize.',
  '- Be explicit about desired behavior — request it directly rather than relying on implication.',
  '- Use calm, normal phrasing. Avoid excessive caps, "CRITICAL", "NEVER", "MUST" — modern models follow instructions more precisely and overtrigger on urgent language.',
  '- Deduplicate: state each rule once in one authoritative section. Repetition dilutes signal and wastes context tokens.',
  '',
  'Tool & workflow guidance:',
  '- Describe tools by what they enable, not just what they do (e.g. "Use files_read to verify assumptions or read lines you plan to edit").',
  '- Include concrete examples for key behaviors — one example teaches more than a paragraph of abstract rules.',
  '- Define effort scaling: when to take shortcuts vs. follow the full workflow.',
  '- Specify output format explicitly (sections, JSON schema, bullet points).',
  '',
  'Multi-agent coordination (when applicable):',
  '- Forward context verbatim between agents — summarizing loses critical details.',
  '- Include exploredFiles in handoffs so downstream agents skip redundant file reads.',
  '- Instruct downstream agents to trust upstream analysis and proceed directly rather than re-exploring.',
  '- Define clear task boundaries: objective, expected output format, tools to use, and what is out of scope.',
  '',
  'Context window management:',
  '- Add compaction awareness: "Your context window will be compacted automatically. Do not stop tasks early. Save progress before compaction."',
  '- Encourage incremental progress and structured state tracking for long tasks.',
  '',
  'Anti-patterns to avoid in the output:',
  '- Mixing instructions with examples in flat paragraphs without structural separation.',
  '- Repeating the same rule in multiple sections.',
  '- Leaving output format ambiguous.',
  '- Passing absolute filesystem paths between isolated agents (use repo-relative paths).',
  '</instruction_quality_guidelines>',
].join('\n');

@Injectable()
export class AiSuggestionsService {
  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly graphDao: GraphDao,
    private readonly graphRegistry: GraphRegistry,
    private readonly templateRegistry: TemplateRegistry,
    private readonly authContext: AuthContextService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
      private readonly litellmService: LitellmService,
      private readonly graphCompiler: GraphCompiler,
    ) {}


  private async callLlm<T>(
    fn: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BaseException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Unknown LLM error';

      throw new InternalException('LLM_REQUEST_FAILED', message, {
        operation,
      });
    }
  }

  async analyzeThread(
    threadId: string,
    payload: ThreadAnalysisRequestDto,
  ): Promise<ThreadAnalysisResponse> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadsDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const graph = await this.graphDao.getOne({
      id: thread.graphId,
      createdBy: userId,
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    let compiledGraph = this.graphRegistry.get(thread.graphId);
    let isStaticContext = false;

    if (!compiledGraph) {
      compiledGraph = await this.graphCompiler.getStaticContext(graph);
      isStaticContext = true;
    }

    try {
      const messages = await this.messagesDao.getAll({
        threadId: thread.id,
        order: { createdAt: 'ASC' },
      });

      const sanitizedMessages = this.sanitizeMessages(
        messages.map((m) => ({ message: m.message, from: m.nodeId })),
        compiledGraph,
      );
      const agents = this.buildAgentContexts(compiledGraph);

      const isContinuation = !!payload.threadId;

      const systemPrompt = isContinuation
        ? undefined
        : [
            'You are an expert AI / agent-ops reviewer.',
            'Analyze the full thread messages and the current agent configuration.',
            'Focus on tool calls, tool execution errors, workflow inefficiencies, and optimization opportunities.',
            'Do NOT focus on the specific agent task or problem in the conversation—instead, focus on how tools were used, what failed, and how the workflow can be optimized.',
            'Identify tool call patterns, error patterns, tool misuse, missing tool features, redundant operations, and workflow bottlenecks.',
            'Recommend concrete, generalizable improvements to tool usage patterns, tool implementations, error handling, and workflow design.',
            'Do not overfit suggestions to this specific case; the agent must stay adaptable to any task, domain, or language.',
            'Keep the response concise, structured, and immediately actionable.',
            'Note: Some message content may show "[truncated]" markers—this is intentional for analysis purposes only. Do not flag truncation as an issue; focus on the patterns and errors visible in the available content.',
            'Additionally, evaluate the agent instructions against prompt-engineering best practices: XML-tag structure, positive vs. negative phrasing, role definition richness, effort scaling, deduplication, output format clarity, and multi-agent coordination patterns (verbatim context forwarding, exploredFiles in handoffs, trust upstream analysis).',
            'Structure the answer with sections:',
            '- Tool call issues: bullet list of tool execution errors, failed calls, missing outputs, or incorrect tool usage patterns.',
            '- Workflow inefficiencies: bullet list of redundant operations, unnecessary tool calls, slow patterns, or suboptimal execution flow.',
            '- Instruction quality: bullet list of improvements to agent system prompt structure, clarity, and adherence to prompt engineering best practices (XML tags, positive instructions, role specificity, deduplication, effort scaling, output format).',
            '- Optimization suggestions: bullet list of improvements to tool configurations, workflow design, error handling, and execution patterns that enhance reliability and performance.',
          ].join('\n');

      const message = isContinuation
        ? (payload.userInput || '').trim()
        : this.buildThreadPrompt({
            thread,
            graph,
            messages: sanitizedMessages,
            agents,
            userInput: payload.userInput,
          });

      const modelName = this.resolveAiSuggestionsModel(payload.model);
      const supportsResponsesApi =
        await this.litellmService.supportsResponsesApi(modelName);
      const data: ResponseData | CompleteData = {
        model: modelName,
        systemMessage: systemPrompt,
        message,
        reasoning: { effort: 'medium' as const },
      };
      const response = await this.callLlm(
        () =>
          supportsResponsesApi
            ? this.openaiService.response(data, {
                previous_response_id: payload.threadId,
              })
            : this.openaiService.complete(data),
        'analyzeThread',
      );

      const analysis = String(response.content || '').trim();

      return {
        analysis,
        conversationId: response.conversationId,
      };
    } finally {
      if (isStaticContext && compiledGraph) {
        await compiledGraph.destroy();
      }
    }
  }


  async suggest(
    graphId: string,
    nodeId: string,
    payload: SuggestAgentInstructionsDto,
  ): Promise<SuggestAgentInstructionsResponse> {
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const node = graph.schema.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new NotFoundException('NODE_NOT_FOUND');
    }

    const template = this.templateRegistry.getTemplate(node.template);
    if (!template || template.kind !== NodeKind.SimpleAgent) {
      throw new BadRequestException(
        'INVALID_NODE_TYPE',
        'Instruction suggestions are only available for agent nodes',
      );
    }

    let compiledGraph = this.graphRegistry.get(graphId);
    let isStaticContext = false;

    if (!compiledGraph) {
      compiledGraph = await this.graphCompiler.getStaticContext(graph);
      isStaticContext = true;
    }

    try {
      const currentInstructions = this.getCurrentInstructions(node.config);
      const tools = this.getConnectedTools(
        graphId,
        nodeId,
        compiledGraph?.edges || graph.schema.edges,
        compiledGraph,
      );
      const mcpInstructions = this.getConnectedMcpInstructions(
        graphId,
        nodeId,
        compiledGraph?.edges || graph.schema.edges,
        compiledGraph,
      );

      const threadId = payload.threadId;
      const isContinuation = !!threadId;

      const systemMessage = isContinuation
        ? undefined
        : this.buildInstructionSystemMessage();
      const message = isContinuation
        ? (payload.userRequest || '').trim()
        : this.buildInstructionRequestPrompt(
            payload.userRequest,
            currentInstructions,
            tools,
            mcpInstructions,
          );

      const modelName = this.resolveAiSuggestionsModel(payload.model);
      const supportsResponsesApi =
        await this.litellmService.supportsResponsesApi(modelName);
      const data: ResponseData | CompleteData = {
        model: modelName,
        systemMessage,
        message,
        reasoning: { effort: 'medium' as const },
      };
      const response = await this.callLlm(
        () =>
          supportsResponsesApi
            ? this.openaiService.response(data, {
                previous_response_id: threadId,
              })
            : this.openaiService.complete(data),
        'suggest',
      );

      const updated = String(response.content || '').trim();
      const baseInstructions = this.stripInstructionExtras(currentInstructions);
      const sanitizedUpdated = updated.length
        ? this.stripInstructionExtras(updated)
        : baseInstructions;

      return {
        instructions: sanitizedUpdated,
        threadId: response.conversationId,
      };
    } finally {
      if (isStaticContext && compiledGraph) {
        await compiledGraph.destroy();
      }
    }

  }

  async suggestGraphInstructions(
    graphId: string,
    payload: SuggestGraphInstructionsRequest,
  ): Promise<SuggestGraphInstructionsResponse> {
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    let compiledGraph = this.graphRegistry.get(graphId);
    let isStaticContext = false;

    if (!compiledGraph) {
      compiledGraph = await this.graphCompiler.getStaticContext(graph);
      isStaticContext = true;
    }

    try {
      const agents = this.buildAgentContexts(compiledGraph);
      if (!agents.length) {
        return { updates: [] };
      }

      const userRequest = payload.userRequest.trim();
      const edges = compiledGraph?.edges || graph.schema.edges;
      const allToolsMap = new Map<string, ConnectedToolInfo>();
      const allMcpMap = new Map<
        string,
        { name: string; instructions?: string }
      >();
      const agentConnections = agents.map((agent) => {
        const tools = this.getConnectedTools(
          graphId,
          agent.nodeId,
          edges,
          compiledGraph,
        );
        tools.forEach((tool) => {
          if (!allToolsMap.has(tool.name)) {
            allToolsMap.set(tool.name, tool);
          }
        });

        const mcpDetails = this.getConnectedMcpDetails(
          graphId,
          agent.nodeId,
          edges,
          compiledGraph,
        );
        mcpDetails.forEach((mcp) => {
          if (!allMcpMap.has(mcp.name)) {
            allMcpMap.set(mcp.name, mcp);
          }
        });

        return {
          nodeId: agent.nodeId,
          toolNames: tools.map((tool) => tool.name),
          mcpNames: mcpDetails.map((mcp) => mcp.name),
        };
      });

      const systemMessage = this.buildGraphInstructionSystemMessage();
      const message = this.buildGraphInstructionRequestPrompt(
        userRequest,
        agents,
        agentConnections,
        Array.from(allToolsMap.values()),
        Array.from(allMcpMap.values()),
      );

      const schema = z.object({
        updates: z.array(
          z.object({
            nodeId: z.string().min(1),
            instructions: z.string().min(1),
          }),
        ),
      });

      const modelName = this.resolveAiSuggestionsModel(payload.model);
      const supportsResponsesApi =
        await this.litellmService.supportsResponsesApi(modelName);
      const data: ResponseJsonData | CompleteJsonData = {
        model: modelName,
        systemMessage,
        message,
        json: true as const,
        jsonSchema: schema,
        reasoning: { effort: 'medium' as const },
      };
      type GraphUpdates = {
        updates?: { nodeId?: string; instructions?: string }[];
      };
      const response = await this.callLlm(
        () =>
          supportsResponsesApi
            ? this.openaiService.response<GraphUpdates>(data)
            : this.openaiService.complete<GraphUpdates>(data),
        'suggestGraphInstructions',
      );

      const parsed = schema.safeParse(response.content);
      if (!parsed.success) {
        throw new BadRequestException(
          'INVALID_GRAPH_INSTRUCTIONS_SUGGESTION',
          'LLM returned invalid graph instructions output',
        );
      }

      const updates: SuggestGraphInstructionsResponse['updates'] = [];
      const expectedIds = new Set(agents.map((agent) => agent.nodeId));
      const suggestionsById = new Map(
        parsed.data.updates.map((entry) => [entry.nodeId, entry.instructions]),
      );

      for (const entry of suggestionsById.keys()) {
        if (!expectedIds.has(entry)) {
          throw new BadRequestException(
            'INVALID_GRAPH_INSTRUCTIONS_SUGGESTION',
            'LLM response included unexpected agent ids',
          );
        }
      }

      for (const agent of agents) {
        const currentInstructions = agent.instructions.trim();
        const suggested = suggestionsById.get(agent.nodeId);

        if (!currentInstructions || !suggested) {
          continue;
        }

        const nextInstructions = this.stripInstructionExtras(suggested);
        const baseInstructions = this.stripInstructionExtras(currentInstructions);

        if (this.isInstructionsUpdated(baseInstructions, nextInstructions)) {
          updates.push({
            nodeId: agent.nodeId,
            ...(agent.name ? { name: agent.name } : {}),
            instructions: nextInstructions,
          });
        }
      }

      return { updates };
    } finally {
      if (isStaticContext && compiledGraph) {
        await compiledGraph.destroy();
      }
    }

  }

  async suggestKnowledgeContent(
    payload: KnowledgeContentSuggestionRequest,
  ): Promise<KnowledgeContentSuggestionResponse> {
    this.authContext.checkSub();

    const isContinuation = !!payload.threadId;
    const systemMessage = isContinuation
      ? undefined
      : [
          'You create or improve knowledge base content for internal docs.',
          'Return ONLY JSON with keys: title, content, tags.',
          'Rules:',
          '- title: short and descriptive.',
          '- content: clear, structured, standalone knowledge doc.',
          '- tags: optional list of short keywords when useful.',
          '- If current content is provided, preserve useful details and only change what the user requested.',
          '- Do not include explanations or commentary outside the JSON.',
          'IMPORTANT: Any content between <<<REFERENCE_ONLY_*>>> and <<<END_REFERENCE_ONLY_*>>> tags is for your reference only - NEVER include this information in your response.',
        ].join('\n');

    const message = isContinuation
      ? payload.userRequest.trim()
      : this.buildKnowledgeSuggestionPrompt(payload);

    const modelName = this.resolveAiSuggestionsModel(payload.model);
    const supportsResponsesApi =
      await this.litellmService.supportsResponsesApi(modelName);
    const knowledgeSchema = z.object({
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()).nullable(),
    });
    const data: ResponseJsonData | CompleteJsonData = {
      model: modelName,
      systemMessage,
      message,
      json: true as const,
      jsonSchema: knowledgeSchema,
      reasoning: { effort: 'medium' as const },
    };
    type KnowledgeResult = {
      title: string;
      content: string;
      tags: string[] | null;
    };
    const response = await this.callLlm(
      () =>
        supportsResponsesApi
          ? this.openaiService.response<KnowledgeResult>(data, {
              previous_response_id: payload.threadId,
            })
          : this.openaiService.complete<KnowledgeResult>(data),
      'suggestKnowledgeContent',
    );

    const validation = this.validateKnowledgeSuggestionResponse(
      response.content,
    );
    if (!validation.success) {
      throw new BadRequestException(
        'INVALID_KNOWLEDGE_SUGGESTION',
        'LLM returned invalid knowledge suggestion output',
      );
    }

    const tags =
      validation.data.tags ??
      (payload.currentTags?.length ? payload.currentTags : undefined);

    return {
      title: validation.data.title,
      content: validation.data.content,
      tags,
      threadId: response.conversationId,
    };
  }

  private buildThreadPrompt(data: {
    thread: ThreadEntity;
    graph: GraphEntity;
    messages: SanitizedMessage[];
    agents: AgentContext[];
    userInput?: string;
  }): string {
    const threadStatusLine = `Thread status: ${data.thread.status}`;
    const userInputSection = data.userInput
      ? ['User request:', data.userInput.trim()]
      : null;

    const agentSection = data.agents.length
      ? data.agents
          .map((agent) => {
            const displayName = agent.name || agent.nodeId;
            const subblockId = `agent_${agent.nodeId}`;
            return [
              `<<<SUBBLOCK id=${subblockId} name="${displayName}">>>`,
              `Agent ${displayName} (${agent.template})`,
              `Instructions:\n${agent.instructions}`,
              `<<<END SUBBLOCK id=${subblockId}>>>`,
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n')
      : 'No agent configuration available.';

    const messagesSection = data.messages.length
      ? this.formatMessagesCompact(data.messages)
      : 'No messages available for this thread.';

    const wrapBlock = (id: string, purpose: string, content: string): string =>
      [
        `<<<BLOCK id=${id} purpose="${purpose}">>>`,
        content,
        `<<<END BLOCK id=${id}>>>`,
      ].join('\n');

    const statusBlock = wrapBlock(
      'information',
      'General information',
      [threadStatusLine, ...(userInputSection || [])].join('\n\n'),
    );
    const agentsBlock = wrapBlock(
      'agents',
      'Providing information about agents',
      ['Agents configuration:', agentSection].join('\n\n'),
    );
    const messagesBlock = wrapBlock(
      'messages',
      'Thread messages',
      ['Thread messages (oldest first):', messagesSection].join('\n\n'),
    );

    return [
      statusBlock,
      agentsBlock,
      messagesBlock,
      'Provide the requested analysis using the structure from the system instructions.',
    ].join('\n\n');
  }

  private formatMessagesCompact(messages: SanitizedMessage[]): string {
    const schema = [
      'Message format:',
      '- Standard messages (human/ai/reasoning/system): #<idx> | <role> | <from> | <content> | [toolCalls: <name> args: <json>; ...]',
      '- Tool messages: #<idx> | tool | <from> | <name> | <content> | [title: <title>]',
      '',
      'Messages:',
    ].join('\n');

    const formattedMessages = messages
      .map((msg, idx) => this.formatMessageCompact(idx + 1, msg))
      .join('\n');

    return `${schema}\n${formattedMessages}`;
  }

  private formatMessageCompact(index: number, msg: SanitizedMessage): string {
    const truncate = (text: string, maxLen: number): string => {
      if (text.length <= maxLen) return text;
      return text.substring(0, maxLen) + '... [truncated]';
    };

    if (msg.role === 'tool') {
      const content = truncate(msg.content, 700);
      const title = msg.title ? ` | title: ${truncate(msg.title, 200)}` : '';
      return `#${index} | tool | ${msg.from} | ${msg.name} | ${content}${title}`;
    }

    const toolCalls = msg.toolCalls?.length
      ? ` | toolCalls: ${msg.toolCalls
          .map((tc) =>
            tc.args
              ? `${tc.name} args: ${truncate(this.safeStringify(tc.args), 500)}`
              : tc.name,
          )
          .join('; ')}`
      : '';

    return `#${index} | ${msg.role} | ${msg.from} | ${msg.content}${toolCalls}`;
  }

  private sanitizeMessages(
    messages: { message: MessageDto; from: string }[],
    compiledGraph: CompiledGraph,
  ): SanitizedMessage[] {
    const sanitized: SanitizedMessage[] = [];

    for (const { message, from } of messages) {
      const fromLabel = this.getNodeDisplayName(compiledGraph, from);

      if (message.role === 'human') {
        sanitized.push({
          role: 'human',
          content: message.content,
          from: fromLabel,
        });
        continue;
      }

      if (message.role === 'ai') {
        sanitized.push({
          role: 'ai',
          content: message.content,
          from: fromLabel,
          toolCalls: message.toolCalls?.map((tc) => ({
            name: tc.name,
            args: isPlainObject(tc.args as unknown)
              ? (tc.args as UnknownRecord)
              : undefined,
            type: typeof tc.type === 'string' ? tc.type : undefined,
          })),
        });
        continue;
      }

      if (message.role === 'reasoning') {
        // Never include reasoning content in LLM prompts.
        continue;
      }

      if (message.role === 'tool') {
        sanitized.push({
          role: 'tool',
          name: message.name,
          content: this.formatToolContent(message.name, message.content),
          from: fromLabel,
          title: message.title,
        });
        continue;
      }

      sanitized.push({
        role: 'system',
        content:
          typeof message.content === 'string'
            ? message.content
            : this.safeStringify(message.content),
        from: fromLabel,
      });
    }

    return sanitized;
  }

  private formatToolContent(name: string, content: unknown): string {
    if (name === 'shell' && isPlainObject(content)) {
      const rec = content as UnknownRecord;
      const exitCode =
        typeof rec.exitCode === 'number'
          ? rec.exitCode
          : Number(rec.exitCode) || 0;
      const stdout = typeof rec.stdout === 'string' ? rec.stdout : undefined;
      const stderr = typeof rec.stderr === 'string' ? rec.stderr : undefined;
      const stdoutChunk = stdout ? ` stdout: ${stdout}` : '';
      const stderrChunk = stderr ? ` stderr: ${stderr}` : '';
      return `exitCode:${exitCode}${stdoutChunk}${stderrChunk}`.trim();
    }

    return this.safeStringify(content);
  }

  private getNodeDisplayName(
    compiledGraph: CompiledGraph,
    nodeId: string,
  ): string {
    const node = compiledGraph.nodes.get(nodeId) as unknown;
    if (!node) {
      return nodeId;
    }

    const nodeType = (node as { type?: unknown }).type;

    if (nodeType === NodeKind.SimpleAgent) {
      const cfg = (node as { config?: unknown }).config;
      const cfgRecord: UnknownRecord | undefined = isPlainObject(cfg)
        ? (cfg as UnknownRecord)
        : undefined;
      const name =
        cfgRecord &&
        isString(cfgRecord.name) &&
        cfgRecord.name.trim().length > 0
          ? cfgRecord.name
          : undefined;
      return name || nodeId;
    }

    if (nodeType === NodeKind.Tool) {
      const instance = (node as { instance?: unknown }).instance;
      if (Array.isArray(instance)) {
        const first = instance[0] as unknown;
        const firstRecord: UnknownRecord | undefined = isPlainObject(first)
          ? (first as UnknownRecord)
          : undefined;
        const name =
          firstRecord &&
          isString(firstRecord.name) &&
          firstRecord.name.trim().length > 0
            ? firstRecord.name
            : undefined;
        return name || nodeId;
      }

      const instanceRecord: UnknownRecord | undefined = isPlainObject(instance)
        ? (instance as UnknownRecord)
        : undefined;
      const name =
        instanceRecord &&
        isString(instanceRecord.name) &&
        instanceRecord.name.trim().length > 0
          ? instanceRecord.name
          : undefined;
      return name || nodeId;
    }

    return nodeId;
  }

  private buildAgentContexts(compiledGraph: CompiledGraph): AgentContext[] {
    const agentNodes = Array.from(compiledGraph.nodes.values()).filter(
      (node) => node.type === NodeKind.SimpleAgent,
    );

    return agentNodes.map((node) => {
      const config = node.config as {
        name?: string;
        description?: string;
        instructions?: string;
      };
      const instanceInstructions = (
        node.instance as {
          currentConfig?: { instructions?: string };
        }
      )?.currentConfig?.instructions;

      const instructions = (
        instanceInstructions ??
        config.instructions ??
        ''
      ).trim();

      return {
        nodeId: node.id,
        template: node.template,
        name: config.name,
        description: config.description,
        instructions,
      };
    });
  }

  private getCurrentInstructions(config: unknown): string {
    const instructions = (config as { instructions?: unknown })?.instructions;

    if (typeof instructions !== 'string' || !instructions.trim()) {
      throw new BadRequestException(
        'INVALID_AGENT_CONFIG',
        'Agent node instructions are not configured',
      );
    }

    return instructions;
  }

  private getOutgoingNodeIds(
    edges: GraphEdgeSchemaType[] | undefined,
    nodeId: string,
  ): Set<string> {
    return new Set(
      (edges || [])
        .filter((edge) => edge.from === nodeId)
        .map((edge) => edge.to),
    );
  }

  private getConnectedTools(
    graphId: string,
    nodeId: string,
    edges: GraphEdgeSchemaType[] | undefined,
    compiledGraph?: CompiledGraph,
  ): ConnectedToolInfo[] {
    const outgoingNodeIds = this.getOutgoingNodeIds(edges, nodeId);
    if (!outgoingNodeIds.size) {
      return [];
    }

    const toolNodes = Array.from(outgoingNodeIds)
      .map((id) => compiledGraph?.nodes.get(id))
      .filter((node): node is CompiledGraphNode => node?.type === NodeKind.Tool);

    return toolNodes.flatMap((toolNode) => {
      // Tool nodes return ToolNodeOutput { tools: BuiltAgentTool[]; instructions?: string }.
      // Be defensive to support legacy states/mocks and partially-configured graphs.
      const tools = (
        ((toolNode.instance as any)?.tools as (BuiltAgentTool | undefined)[]) ??
        []
      ).filter((t): t is BuiltAgentTool => Boolean(t));

      return tools.map(
        (tool): ConnectedToolInfo => ({
          name: tool.name,
          description: tool.description ?? '',
          instructions: tool.__instructions,
        }),
      );
    });
  }

  private getConnectedMcpInstructions(
    graphId: string,
    nodeId: string,
    edges: GraphEdgeSchemaType[] | undefined,
    compiledGraph?: CompiledGraph,
  ): string | undefined {
    const outgoingNodeIds = this.getOutgoingNodeIds(edges, nodeId);
    if (!outgoingNodeIds.size) {
      return undefined;
    }

    const mcpNodes = Array.from(outgoingNodeIds)
      .map((id) => compiledGraph?.nodes.get(id))
      .filter((node): node is CompiledGraphNode => node?.type === NodeKind.Mcp);

    const blocks = mcpNodes
      .map((mcpNode) => {
        const mcpService = mcpNode.instance as BaseMcp<unknown>;
        if (!mcpService) {
          return undefined;
        }

        const instructions = mcpService.getDetailedInstructions?.(
          mcpService.config as never,
        );

        if (typeof instructions !== 'string') {
          return undefined;
        }

        const trimmed = instructions.trim();
        if (!trimmed) {
          return undefined;
        }

        return this.wrapBlock(trimmed, 'mcp_instructions');
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## MCP Instructions', ...blocks].join('\n\n');
  }

  private getConnectedMcpDetails(
    graphId: string,
    nodeId: string,
    edges: GraphEdgeSchemaType[] | undefined,
    compiledGraph?: CompiledGraph,
  ): { name: string; instructions?: string }[] {
    const outgoingNodeIds = this.getOutgoingNodeIds(edges, nodeId);
    if (!outgoingNodeIds.size) {
      return [];
    }

    const mcpNodes = Array.from(outgoingNodeIds)
      .map((id) => compiledGraph?.nodes.get(id))
      .filter((node): node is CompiledGraphNode => node?.type === NodeKind.Mcp);

    const details = mcpNodes.flatMap((mcpNode) => {
      const mcpService = mcpNode.instance as BaseMcp<unknown>;
      if (!mcpService) {
        return [];
      }

      const config =
        mcpService.config && typeof mcpService.getMcpConfig === 'function'
          ? mcpService.getMcpConfig(mcpService.config as never)
          : undefined;
      const name = config?.name?.trim() || mcpNode.template || mcpNode.id;
      const instructions = mcpService.getDetailedInstructions?.(
        mcpService.config as never,
      );

      return [
        {
          name,
          ...(typeof instructions === 'string' ? { instructions } : undefined),
        },
      ];
    });

    const unique = new Map<string, { name: string; instructions?: string }>();
    for (const entry of details) {
      if (!unique.has(entry.name)) {
        unique.set(entry.name, entry);
      }
    }

    return Array.from(unique.values());
  }


  private buildInstructionRequestPrompt(
    userRequest: string,
    currentInstructions: string,
    tools: ConnectedToolInfo[],
    mcpInstructions?: string,
    extraBlocks?: string[],
  ): string {
    const toolsBlock = this.buildConnectedToolsReferenceBlock(tools);
    const mcpBlock = this.buildMcpReferenceBlock(mcpInstructions);

    return [
      `User request:\n${userRequest}`,
      `Current instructions:\n<current_instructions>\n${currentInstructions}\n</current_instructions>`,
      ...(extraBlocks ?? []),
      toolsBlock,
      mcpBlock,
      'Provide the full updated instructions. Do not include a preamble.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildBaseInstructionSystemRules(): string[] {
    return [
      'Use the current instructions as a base and apply the user request.',
      'Do not delete, simplify, compress, paraphrase, "clean up", merge, reorder, or otherwise modify existing instructions by default.',
      'All current instructions must remain exactly as-is (wording + structure), unless the user explicitly asks to change/remove/simplify specific parts.',
      'Only add the minimal necessary additions to satisfy the user request, without altering unrelated content.',
      "You can analyze connected tool capabilities and their usage guidelines. But don't duplicate Connected tools and MCP servers information in your response. You can only refer to it if needed.",
      'Never include tool descriptions, tool lists, or MCP instructions in the output.',
      'Only modify content inside <current_instructions> tags. Do not add or remove anything outside these tags.',
      'Do NOT include the <current_instructions> tags in your output.',
      'IMPORTANT: Any content between <<<REFERENCE_ONLY_*>>> and <<<END_REFERENCE_ONLY_*>>> tags is for your reference only - NEVER include this information in your response. You can analyze it and refer to it, but do not duplicate it in your output.',
      INSTRUCTION_BEST_PRACTICES,
    ];
  }

  private buildInstructionSystemMessage(): string {
    return [
      'You rewrite agent system instructions.',
      ...this.buildBaseInstructionSystemRules(),
      'Keep the result concise, actionable, and focused on how the agent should behave.',
      'Return only the updated instructions text without extra commentary.',
    ].join('\n');
  }

  private buildGraphInstructionSystemMessage(): string {
    return [
      'You rewrite system instructions for multiple agents.',
      ...this.buildBaseInstructionSystemRules(),
      'Keep the result concise, actionable, and focused on how each agent should behave.',
      'Return ONLY JSON in the shape: { "updates": [ { "nodeId": "...", "instructions": "..." } ] }',
      'Include ONLY agents that require changes. If no changes are needed, return { "updates": [] }.',
      'For each update, return the FULL updated instructions text (not a diff). Apply only minimal changes requested by the user.',
    ].join('\n');
  }

  private buildKnowledgeSuggestionPrompt(
    payload: KnowledgeContentSuggestionRequest,
  ): string {
    const currentTitle = payload.currentTitle?.trim();
    const currentContent = payload.currentContent?.trim();
    const currentTags = payload.currentTags?.filter(Boolean);
    const currentSection = currentContent
      ? [
          '<<<REFERENCE_ONLY_CURRENT_DOC>>>',
          currentTitle ? `Title: ${currentTitle}` : undefined,
          currentTags?.length ? `Tags: ${currentTags.join(', ')}` : undefined,
          'Content:',
          currentContent,
          '<<<END_REFERENCE_ONLY_CURRENT_DOC>>>',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No existing knowledge document was provided.';

    return [
      `User request:\n${payload.userRequest}`,
      currentSection,
      'Return JSON only with keys: title, content, tags.',
    ].join('\n\n');
  }

  private isInstructionsUpdated(current: string, updated: string): boolean {
    return current.trim() !== updated.trim();
  }

  private stripInstructionExtras(instructions: string): string {
    const withoutBlocks = instructions
      .replace(/<tool_description>[\s\S]*?<\/tool_description>/g, '')
      .replace(
        /<tool_group_instructions>[\s\S]*?<\/tool_group_instructions>/g,
        '',
      )
      .replace(/<mcp_instructions>[\s\S]*?<\/mcp_instructions>/g, '')
      .replace(/<<<REFERENCE_ONLY_[\s\S]*?>>>/g, '')
      .replace(/<<<END_REFERENCE_ONLY_[\s\S]*?>>>/g, '')
      .replace(/##\s+Tool Instructions\s*/g, '')
      .replace(/##\s+Tool Group Instructions\s*/g, '')
      .replace(/##\s+MCP Instructions\s*/g, '')
      .trim();

    return withoutBlocks.replace(/\n{3,}/g, '\n\n').trim();
  }

  private formatToolEntry(tool: ConnectedToolInfo): string {
    const details = [`Name: ${tool.name}`, `Description: ${tool.description}`];

    if (tool.instructions) {
      details.push(
        `Instructions:\n${this.wrapBlock(tool.instructions, 'tool_description')}`,
      );
    }

    return details.join('\n');
  }

  private buildToolsReferenceBlock(
    tools: ConnectedToolInfo[],
    tag: string,
    emptyFallback?: string,
  ): string | undefined {
    const toolsSection = tools.length
      ? tools.map((tool) => this.formatToolEntry(tool)).join('\n\n')
      : emptyFallback;

    if (!toolsSection) {
      return undefined;
    }

    return [
      `<<<REFERENCE_ONLY_${tag}>>>`,
      toolsSection,
      `<<<END_REFERENCE_ONLY_${tag}>>>`,
    ].join('\n');
  }

  private buildConnectedToolsReferenceBlock(
    tools: ConnectedToolInfo[],
  ): string {
    return this.buildToolsReferenceBlock(
      tools,
      'CONNECTED_TOOLS',
      'No connected tools available.',
    ) as string;
  }

  private buildMcpReferenceBlock(mcpInstructions?: string): string | undefined {
    return mcpInstructions
      ? [
          '<<<REFERENCE_ONLY_MCP>>>',
          mcpInstructions,
          '<<<END_REFERENCE_ONLY_MCP>>>',
        ].join('\n')
      : undefined;
  }

  private buildAllToolsReferenceBlock(
    tools: ConnectedToolInfo[],
  ): string | undefined {
    return this.buildToolsReferenceBlock(tools, 'ALL_TOOLS');
  }

  private buildAllMcpReferenceBlock(
    mcps: { name: string; instructions?: string }[],
  ): string | undefined {
    if (!mcps.length) {
      return undefined;
    }

    const mcpBlocks = mcps
      .map((mcp) => {
        const details = [`Name: ${mcp.name}`];
        if (mcp.instructions) {
          details.push(
            `Instructions:\n${this.wrapBlock(
              mcp.instructions,
              'mcp_instructions',
            )}`,
          );
        }
        return details.join('\n');
      })
      .join('\n\n');

    return [
      '<<<REFERENCE_ONLY_ALL_MCP>>>',
      mcpBlocks,
      '<<<END_REFERENCE_ONLY_ALL_MCP>>>',
    ].join('\n');
  }

  private buildGraphInstructionRequestPrompt(
    userRequest: string,
    agents: AgentContext[],
    agentConnections: {
      nodeId: string;
      toolNames: string[];
      mcpNames: string[];
    }[],
    allTools: ConnectedToolInfo[],
    allMcps: { name: string; instructions?: string }[],
  ): string {
    const agentSummary = agents
      .map((agent) => {
        const name = agent.name?.trim() || agent.nodeId;
        const description = agent.description?.trim();
        return [
          `- ${name} (${agent.nodeId})`,
          description ? `  Description: ${description}` : undefined,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    const agentBlocks = agents
      .map((agent) => {
        const name = agent.name?.trim() || agent.nodeId;
        const description = agent.description?.trim();
        const connection = agentConnections.find(
          (entry) => entry.nodeId === agent.nodeId,
        );
        const toolNames = connection?.toolNames ?? [];
        const mcpNames = connection?.mcpNames ?? [];

        return [
          `Agent: ${name} (${agent.nodeId})`,
          description ? `Description: ${description}` : undefined,
          `Current instructions:\n<current_instructions>\n${agent.instructions}\n</current_instructions>`,
          toolNames.length
            ? `Connected tools: ${toolNames.join(', ')}`
            : 'Connected tools: none',
          mcpNames.length
            ? `Connected MCP: ${mcpNames.join(', ')}`
            : 'Connected MCP: none',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    const allToolsBlock = this.buildAllToolsReferenceBlock(allTools);
    const allMcpBlock = this.buildAllMcpReferenceBlock(allMcps);

    return [
      `User request:\n${userRequest}`,
      'Agents (overview):',
      agentSummary || 'No agent metadata available.',
      'Agent details:',
      agentBlocks,
      allToolsBlock,
      allMcpBlock,
      'Remember: reference-only blocks must never be copied into output.',
      'Return JSON only. Only include updates for agents whose instructions must change.',
    ].join('\n\n');
  }

  private wrapBlock(content: string, tag: string): string {
    return [`<${tag}>`, content, `</${tag}>`].join('\n');
  }

  private validateKnowledgeSuggestionResponse(value: unknown):
    | {
        success: true;
        data: {
          title: string;
          content: string;
          tags?: string[];
        };
      }
    | {
        success: false;
      } {
    if (!value || typeof value !== 'object') {
      return { success: false };
    }

    const record = value as {
      title?: unknown;
      content?: unknown;
      tags?: unknown;
    };

    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const content =
      typeof record.content === 'string' ? record.content.trim() : '';
    const tags = Array.isArray(record.tags)
      ? record.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : undefined;

    if (!title || !content) {
      return { success: false };
    }

    return {
      success: true,
      data: {
        title,
        content,
        tags: tags?.length ? tags : undefined,
      },
    };
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private resolveAiSuggestionsModel(model?: string): string {
    return model || this.llmModelsService.getAiSuggestionsDefaultModel();
  }
}
