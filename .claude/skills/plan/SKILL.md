---
name: plan
description: "Analyze a task and produce an implementation-ready specification before coding begins. Explores both geniro/ and geniro/apps/web/ codebases, evaluates multiple approaches prioritizing quality over compatibility, and outputs a step-by-step plan with file paths, verification steps, and test scenarios. Use before implementing any non-trivial feature or fix."
context: fork
agent: architect-agent
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
argument-hint: "[feature or task description]"
---

# Architecture Plan

Analyze the following task and produce an implementation-ready specification:

$ARGUMENTS

## Context

The Geniro platform consists of two repositories:
- **geniro/** — NestJS API backend (MikroORM, Vitest, Zod DTOs)
- **geniro/apps/web/** — React frontend (Vite, Ant Design, Refine, Socket.io)

## Your Task

1. **Explore both codebases** — read project docs, find related code, understand existing patterns.
2. **Design the best solution** — consider multiple approaches, including ones that require significant changes. Prioritize quality over compatibility with current patterns. If rewriting is the better path, recommend it.
3. **Produce a full specification** with:
   - Risk assessment (scope, breaking changes, confidence, rollback)
   - File-level scope (direct changes + ripple effects)
   - Step-by-step implementation plan with verification actions per step
   - Key test scenarios (happy path + edge/error cases)
   - List of explored files so engineers can skip redundant reads
4. **Separate API and Web work** clearly so it can be delegated to the right agents.

Be thorough but pragmatic. The goal is a spec that engineers can execute without follow-up questions.
