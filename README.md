# Ai company

An open-source platform to build, run, and manage AI agent graphs using LangGraph and a pluggable node templating system. Define graphs of triggers → agents → tools/resources → runtimes; compile, run, and interact via REST and notifications. Built with Turbo and pnpm; unit tests via Vitest and E2E via Cypress.

## Overview
Build, run, and manage AI agent graphs. A graph is a set of nodes (triggers, agents, tools, resources, runtimes) connected by edges. Graphs are validated, compiled, and executed with LangGraph. You can invoke triggers to start agent runs, track progress via notifications, and destroy graphs safely.

## Features
- Graph schema with Zod validation and a template-based node system
- SimpleAgent powered by LangGraph StateGraph (summarization, tool execution, title generation, usage guards)
- Pluggable tools (web search via Tavily, shell) and resources (GitHub)
- Triggers (manual) to invoke agents with messages
- Runtime execution via Docker (optional Docker-in-Docker)
- Threads and checkpointing with Postgres using LangGraph Checkpoint
- REST API: create/update/run/destroy graphs and execute triggers
- Swagger/OpenAPI; E2E tests (Cypress) and unit tests (Vitest)
- Metrics, logging, and auth-ready HTTP server

## Monorepo structure
- apps/
  - api — Graph orchestration API (compile/run graphs, triggers, notifications)
- packages/
  - common — bootstrapper, logger, exceptions, shared utils
  - http-server — Fastify server, Swagger, global pipes/filters, auth hooks
  - metrics — Prometheus metrics module/extension
  - typeorm — migrations/seeds helpers and `BaseDao`
  - cypress — Cypress utilities and OpenAPI generator

Key API modules (apps/api/src/v1): `graphs`, `graph-templates`, `agents`, `agent-tools`, `agent-triggers`, `graph-resources`, `runtime`, `notifications`, `threads`.

## How it works
1) Define a graph schema: list nodes (with a `template` and `config`) and edges between them. Templates encode allowed inputs/outputs and required connections.
2) Compile: `GraphCompiler` validates the schema, wires node instances from the `TemplateRegistry`, starts triggers/runtimes, and emits notifications.
3) Run: `GraphsService` registers a compiled graph in a registry; triggers can then invoke agents with messages (threads/checkpoints maintained in Postgres).
4) Destroy: gracefully stops triggers and agents, and tears down runtimes/containers.


## Getting Started

We are using `Node 22.x`!

## Install Dependencies
Run `pnpm install` - this will install all dependencies in the root and in all packages.

To run the necessary dependencies, run the `pnpm run deps:up` command - it will start the containers with the database and so on.
You need to run it only once - when you start your work.

In order to run the application in development mode (with automatic reloading when any changes are applied):
- `cd apps/api && pnpm run start:dev`

To compile and run in production:
- From repo root: `pnpm run build`
- Then start the desired app, e.g.: `node ./apps/api/dist/main.js`

Each application contains env variables that can be configured for each environment separately in files `environment.ts`.
Also, you can replace some variables by created `.env` file

## Tests

See `.guidelines/testing.md` for full details on unit and E2E testing.

Important: before marking any task as done, always run the full project check and ensure it passes:
```bash
pnpm run full-check
```
This builds, lints, builds test targets, and runs unit tests.

## Development workflow
- Use conventional commits via `pnpm commit`
- Keep code style consistent with `.guidelines/code-guidelines.md`
- Before marking work as done, run `pnpm run full-check` (build, lint, unit tests)

## Contributing
Contributions are welcome! If you plan a significant change, please open an issue first to discuss what you would like to change.
- Follow the guidelines in `.guidelines/code-guidelines.md`
- Add tests where appropriate
- Keep docs up to date

## Commitizen
For generate commits you can use `pnpm commit` command. 

## Documentation
- Code style and patterns: `.guidelines/code-guidelines.md`
- Testing and E2E: `.guidelines/testing.md`

## Docker

You can use docker and docker-compose for applications (podman).

For example, you can run this command from the root dir `podman build -f ./apps/$appname/Dockerfile -t $appname:latest .`
and then `podman run $appname:latest`

Example: `podman build -f ./apps/api/Dockerfile -t api:latest .`
`podman run api:latest`

## DB
We use `TypeOrm`. Automatic synchronization is disabled in order to avoid production errors.
Instead, you should generate migrations each time, which will run automatically when the server starts.

`pnpm run migration:create {name}` - creates migration in `src/db/migrations` dir
`pnpm run migration:generate {name}` - generate migration based on current entities, {name} should be replaced with some comment, like: add-date-field-to-transactions-table
`pnpm run migration:run` - run all pending migrations
`pnpm run migration:revert` - revert last migration

### Database Seeding

We also support database seeding to populate tables with initial data:

`pnpm run seed:create {name}` - creates a timestamped seed file in `src/db/seeds` dir
`pnpm run seed:run-all` - runs all seed files in order of their timestamps

Locally for each service we can create different db. Postgres create it automatically, you just need update `DATABASES` env in `docker-compose`

## Graph API quick tour

- Create a graph
  - POST `/graphs` with `name`, `version`, `temporary`, and `schema` (nodes + edges)
- Run/Destroy a graph
  - POST `/graphs/:id/run`
  - POST `/graphs/:id/destroy`
- Execute a trigger on a running graph
  - POST `/graphs/:graphId/triggers/:triggerId/execute` with messages and options

Minimal example schema:
```json
{
  "nodes": [
    { "id": "trigger-1", "template": "manual-trigger", "config": {} },
    { "id": "agent-1", "template": "simple-agent", "config": { "instructions": "You are helpful.", "invokeModelName": "gpt-5-mini" } },
    { "id": "web-search-1", "template": "web-search-tool", "config": { "apiKey": "<tavily-key>" } }
  ],
  "edges": [
    { "from": "trigger-1", "to": "agent-1" },
    { "from": "agent-1", "to": "web-search-1" }
  ]
}
```

Swagger is available at `/swagger` (OpenAPI JSON at `/swagger-api-json`). Authentication is enabled; configure your provider via `@packages/http-server` and set a Bearer token.

### What’s inside nodes
- `manual-trigger` — starts a thread and invokes an agent with your messages
- `simple-agent` — LangGraph-based agent with summarization and tool execution; supports checkpoints/threads
- `web-search-tool` — Tavily-powered web search tool
- `shell-tool` — run shell commands inside a runtime
- `docker-runtime` — isolated container to execute tools/commands (supports optional Docker-in-Docker)

### State, threads, and checkpoints
- Threads are identified as `<graphId>:<uuid>` and persisted; checkpoints are per-node namespaces
- Postgres-backed saver via `@langchain/langgraph-checkpoint`
- Graph/agent lifecycle events are published via notifications
