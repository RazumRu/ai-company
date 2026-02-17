# AI Company

Open-source platform for building, running, and managing AI agent workflows. Design agents as visual graphs, connect them to tools, and execute them in isolated environments — all through a REST API with real-time updates.

> **This repository contains the backend API.** The web UI lives at [ai-company-web](https://github.com/RazumRu/ai-company-web).

## Features

- **Visual graph-based workflows** — Compose triggers, agents, tools, and runtimes into directed graphs with a pluggable node template system
- **LLM-powered agents** — Built on [LangGraph](https://github.com/langchain-ai/langgraph) with summarization, tool calling, checkpointing, and configurable iteration limits
- **Built-in tools** — Web search (Tavily), shell execution, file operations, GitHub integration, codebase search, knowledge base, and agent-to-agent communication
- **Sandboxed execution** — Tools run inside Docker containers with configurable resource limits
- **Multi-model support** — Route to OpenAI, Anthropic, Google, MiniMax, Z.ai, and local models via [OpenRouter](https://openrouter.ai/) + [LiteLLM](https://github.com/BerriAI/litellm) proxy
- **Knowledge base** — Embed documents into [Qdrant](https://qdrant.tech/) for semantic search and retrieval-augmented generation
- **Real-time notifications** — Track agent progress via Socket.IO WebSocket events
- **Graph versioning** — Revisions with JSON patch diffs, automatic semver, and rollback support
- **Sub-agents** — Orchestrate child agents from within a parent agent's workflow
- **MCP support** — Connect external tools via the [Model Context Protocol](https://modelcontextprotocol.io/)

## How It Works

1. **Define** a graph — pick node templates (trigger, agent, tools, runtime) and connect them with edges
2. **Compile** — the platform validates your schema, wires up node instances, and starts runtimes
3. **Run** — fire a trigger to kick off an agent; threads and checkpoints are persisted automatically
4. **Observe** — stream real-time events over WebSockets as agents think, call tools, and produce results

## Quick Start

### Prerequisites

- **Node.js 24+**
- **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Docker** or **Podman** (for Postgres, Redis, Qdrant, Keycloak, LiteLLM)

### Setup

```bash
# Clone and install
git clone https://github.com/RazumRu/ai-company.git
cd ai-company
pnpm install

# Configure API keys (see "API Keys" section below)
cp .env.example .env   # then fill in your keys

# Start infrastructure (Postgres, Redis, Qdrant, Keycloak, LiteLLM)
pnpm deps:up

# Start the API server (port 5000, hot-reload)
cd apps/api && pnpm start:dev
```

The API is now running at `http://localhost:5000`. Swagger docs are available at `/swagger-api`.

### Minimal Example

Create and run a graph with a trigger, an agent, and a web search tool:

```bash
# 1. Create a graph
curl -X POST http://localhost:5000/api/v1/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-first-graph",
    "schema": {
      "nodes": [
        { "id": "trigger-1", "template": "manual-trigger", "config": {} },
        { "id": "agent-1", "template": "simple-agent", "config": {
            "instructions": "You are a helpful assistant.",
            "invokeModelName": "gpt-5-mini"
        }},
        { "id": "search-1", "template": "web-search-tool", "config": {
            "apiKey": "<your-tavily-key>"
        }}
      ],
      "edges": [
        { "from": "trigger-1", "to": "agent-1" },
        { "from": "agent-1", "to": "search-1" }
      ]
    }
  }'

# 2. Run the graph
curl -X POST http://localhost:5000/api/v1/graphs/<graph-id>/run

# 3. Execute the trigger with a message
curl -X POST http://localhost:5000/api/v1/graphs/<graph-id>/triggers/trigger-1/execute \
  -H "Content-Type: application/json" \
  -d '{ "messages": [{ "content": "What happened in tech today?" }] }'
```

### Local LLM (Offline)

To run without cloud API keys, install and use Ollama models:

```bash
pnpm local-llm:install   # Download models
pnpm local-llm:start     # Start Ollama server
```

Then set `LLM_USE_OFFLINE_MODEL=true` in your `.env` file.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS + Fastify |
| Agent Runtime | LangGraph + LangChain |
| Database | PostgreSQL (+ pgvector) |
| Vector Store | Qdrant |
| Cache & Queue | Redis + BullMQ |
| LLM Proxy | LiteLLM + OpenRouter (OpenAI, Anthropic, Google, Ollama) |
| Auth | Keycloak |
| Containerization | Docker / Podman |
| Monorepo | pnpm + Turborepo |

## Project Structure

```
apps/api/          Main NestJS API application
packages/
  common/          Logger, exceptions, shared utilities
  http-server/     Fastify setup, Swagger, auth middleware
  metrics/         Prometheus integration
  typeorm/         Database helpers, BaseDao, migrations
  cypress/         E2E test utilities
```

## API Keys

Create a `.env` file in the repo root with your provider keys:

```env
OPENROUTER_API_KEY=sk-or-v1-...
GITHUB_PAT_TOKEN=ghp_...
```

| Key | Required | Used for |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes (unless using Ollama) | All cloud LLM calls and embeddings via OpenRouter + LiteLLM |
| `GITHUB_PAT_TOKEN` | No | GitHub tool (repo access, PRs, commits) |

These keys are read by docker-compose and passed to the LiteLLM container at startup. All cloud models are routed through [OpenRouter](https://openrouter.ai/), which provides access to OpenAI, Anthropic, Google, MiniMax, Z.ai, and many other providers with a single API key. In the future, API keys will be configurable through the web UI.

## LLM Configuration

All LLM calls go through a [LiteLLM](https://github.com/BerriAI/litellm) proxy that runs as part of the docker-compose stack (port 4000). LiteLLM routes requests to the right provider based on the model name configured in `litellm.yaml`. You can also connect any OpenAI-compatible provider (Azure, Anthropic, Groq, etc.) — see the [LiteLLM docs](https://docs.litellm.ai/) for the full list.

### Using Cloud Models (via OpenRouter)

Make sure your `.env` file contains `OPENROUTER_API_KEY` (see above), then start the infrastructure:

```bash
pnpm deps:up
```

Pre-configured cloud models (in `litellm.yaml`):

| Model name | Provider | Notes |
|---|---|---|
| `gpt-5-mini` | OpenAI | Default mini model |
| `gpt-5.2` | OpenAI | Default large model |
| `gpt-5.2-codex` | OpenAI | Code generation |
| `gpt-5.1-codex-mini` | OpenAI | Mini code generation |
| `text-embedding-3-small` | OpenAI | Embeddings |
| `claude-sonnet-4.5` | Anthropic | |
| `claude-opus-4.6` | Anthropic | |
| `claude-haiku-4.5` | Anthropic | |
| `gemini-3-flash-preview` | Google | |
| `glm-5` | Z.ai | |
| `openrouter/minimax-m2.5` | MiniMax | |

All cloud models route through [OpenRouter](https://openrouter.ai/) via the LiteLLM proxy. You can add more models by editing `litellm.yaml` in the repo root — any model available on OpenRouter can be added with the `openrouter/` prefix. See the [LiteLLM docs](https://docs.litellm.ai/) for other supported providers.

### Using Local Models (Ollama)

Run fully offline with no API keys required. Install the [Ollama](https://ollama.com/download) client first, then:

```bash
# 1. Download the pre-configured models
pnpm local-llm:install

# 2. Start Ollama server
pnpm local-llm:start

# 3. Tell the API to use offline models
# Add to .env in the repo root:
echo "LLM_USE_OFFLINE_MODEL=true" >> .env

# 4. Start infrastructure and API
pnpm deps:up
cd apps/api && pnpm start:dev
```

You can also pull any other model from the [Ollama library](https://ollama.com/library) with `ollama pull <model>` and add it to `litellm.yaml`.

Pre-configured local models:

| Model name | Role | Size |
|---|---|---|
| `glm-4.7-flash` | Coding (default offline) | ~9 GB |
| `qwen3-coder:30b` | Coding (large) | ~18 GB |
| `qwen3-coder-next` | Coding (next-gen) | varies |
| `qwen2.5-coder:7b` | Coding (mini) | ~4.5 GB |
| `phi3.5:3.8b-mini-instruct-q4_K_M` | General (mini) | ~2.2 GB |
| `qwen3-embedding:4b` | Embeddings | ~2.5 GB |

### LLM Environment Variables

| Variable | Description | Default |
|---|---|---|
| `LLM_BASE_URL` | LiteLLM proxy URL | `http://localhost:4000` |
| `LITELLM_MASTER_KEY` | LiteLLM admin key | `master` (dev) |
| `LLM_LARGE_MODEL` | Default large model | `openai/gpt-5.2` |
| `LLM_MINI_MODEL` | Default mini model | `gpt-5-mini` |
| `LLM_LARGE_CODE_MODEL` | Code generation model | `gpt-5.2-codex` |
| `LLM_EMBEDDING_MODEL` | Embedding model | `openai/text-embedding-3-small` |
| `LLM_USE_OFFLINE_MODEL` | Switch to Ollama models | `false` |
| `LLM_OFFLINE_CODING_MODEL` | Offline coding model | `glm-4.7-flash` |
| `LLM_OFFLINE_EMBEDDING_MODEL` | Offline embedding model | `qwen3-embedding:4b` |
| `LLM_REQUEST_TIMEOUT_MS` | LLM request timeout | `600000` (10 min) |

## Configuration

The API is configured through environment variables. Create a `.env` file in the repo root (or edit `apps/api/src/environments/environment.dev.ts` for dev defaults):

| Variable | Description | Default |
|---|---|---|
| `HTTP_PORT` | API server port | `5000` |
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `LLM_USE_OFFLINE_MODEL` | Use local Ollama models | `false` |
| `AUTH_DEV_MODE` | Skip Keycloak auth in dev | `true` |
| `CREDENTIAL_ENCRYPTION_KEY` | 64-char hex for AES-256-GCM | dev default provided |

See `apps/api/src/environments/environment.prod.ts` for the full list.

## Development

```bash
pnpm build              # Build everything
pnpm lint:fix           # Auto-fix lint + formatting
pnpm test:unit          # Run unit tests
pnpm run full-check     # Build + lint + test (run before submitting PRs)
```

Database migrations are auto-generated from entity changes:

```bash
cd apps/api
pnpm run migration:generate    # Generate migration from entity diff
pnpm run migration:revert      # Revert last migration
```

Use conventional commits:

```bash
pnpm commit
```

## Contributing

Contributions are welcome! If you're planning a significant change, please open an issue first to discuss your approach.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes and add tests
4. Run `pnpm run full-check` to verify everything passes
5. Submit a pull request

## License

MIT License with [Commons Clause](https://commonsclause.com/). You can use, modify, and redistribute the software freely, but you may not sell it as a commercial product or service. See [LICENSE](LICENSE) for details.
