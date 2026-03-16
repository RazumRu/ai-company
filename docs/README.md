# Development Guidelines

Welcome to the Geniro API development guidelines. This directory contains comprehensive documentation for working on the project.

## 📚 Documentation Structure

### [Project Structure](./project-structure.md)
Learn about the project architecture, monorepo organization, and how different components (DTOs, DAOs, Services, Controllers, Modules) work together.

**Topics covered:**
- Monorepo structure
- Application architecture layers
- Feature organization
- Database management
- Project setup and prerequisites

### [Code Guidelines](./code-guidelines.md)
Follow these coding standards and best practices to maintain code quality and consistency.

**Topics covered:**
- TypeScript best practices (no `any`, proper imports)
- DTO guidelines with Zod schemas
- DAO patterns (filter-based search over specific methods)
- Naming conventions
- Error handling
- Commit guidelines

### [Testing Guidelines](./testing.md)
Complete guide for running and writing tests, including unit tests and E2E tests.

**Topics covered:**
- Unit testing with Vitest
- E2E testing with Cypress
- How to run tests properly
- E2E prerequisites (server + dependencies via `pnpm deps:up`)
- Writing effective tests
- Test coverage

### [Making Changes Workflow](./making-changes.md)
Step-by-step workflow for making changes to the codebase, from development to commit.

**Topics covered:**
- Complete workflow: build → build tests → lint → test → E2E test
- Quick reference commands
- Troubleshooting common issues
- Pre-push checklist

## Quick Start

1. **New to the project?** Start with [Project Structure](./project-structure.md)
2. **Ready to code?** Read [Code Guidelines](./code-guidelines.md)
3. **Making changes?** Follow [Making Changes Workflow](./making-changes.md)
4. **Writing tests?** Check [Testing Guidelines](./testing.md)
5. **Before finishing any work:** Run the full check:

```bash
pnpm run full-check
```

## Essential Commands

```bash
# Setup
pnpm install
pnpm deps:up

# Development
cd apps/api && pnpm start:dev

# Quality checks (in order)
pnpm build
pnpm build:tests
pnpm lint:fix
pnpm test:unit
pnpm test:e2e  # (server must be running)

# Commit
pnpm commit
```

## Local models (Ollama)

Use local Ollama models to keep the platform working when you are offline or do
not want to call hosted providers.

### Install the local models

> **Note:** Installing local models requires at least 32GB RAM and
> ~40GB of available disk space.

Run the setup script from the repo root:

```bash
./scripts/install-local-models.sh
```

This installs Ollama (if needed), starts it, and pulls `qwen3:32b-q4_K_M`,
`qwen3-coder:30b`, and `qwen3-embedding:4b`.

### Run a model manually (optional)

```bash
ollama run qwen3-coder:30b
```

### Configure Geniro to use Ollama models

Set the standard `LLM_*_MODEL` env vars to point at your Ollama models:

```bash
LLM_MINI_MODEL=ollama/phi3.5:latest
LLM_LARGE_CODE_MODEL=ollama/qwen3-coder:30b
LLM_MINI_CODE_MODEL=ollama/qwen2.5-coder:7b
LLM_EMBEDDING_MODEL=ollama/qwen3-embedding:4b
```

You can use any model from the [Ollama library](https://ollama.com/library) as
long as it is added to `litellm.yaml`.

## Need Help?

- Check the specific guideline document for detailed information
- Review the troubleshooting sections in each guide
- Ask your team members for clarification

