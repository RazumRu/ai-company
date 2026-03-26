---
name: security-audit
description: "Run an OWASP Top 10 focused security audit on recent code changes. Checks for injection risks, broken auth, sensitive data exposure, missing input validation, XSS, and more. Use after implementation or during code review."
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
argument-hint: "[what to audit — e.g., 'recent changes', 'the graph revision service', branch name]"
context: fork
agent: security-auditor-agent
---

Perform an OWASP Top 10 security audit on the following:

## What to Audit

$ARGUMENTS

## Context

The Geniro platform consists of two repositories:
- **geniro/** — NestJS API backend (TypeORM, Vitest, Zod DTOs, Keycloak auth)
- **geniro/apps/web/** — React frontend (Vite, Ant Design, Refine, Socket.io)

## Your Task

1. **Identify what changed** — use `git diff`, `git status`, or read the specific files/areas mentioned.
2. **Audit every changed file** against the OWASP Top 10 checklist, adapted for this stack.
3. **Check cross-cutting concerns** — auth decorators on new endpoints, input validation on new DTOs, XSS vectors in new React components.
4. **Run dependency audit** if package.json changed: `cd geniro && pnpm audit --json 2>/dev/null || true` or `cd geniro/apps/web && pnpm audit --json 2>/dev/null || true`.
5. **Produce a Security Audit Report** with the standard format: risk level, findings with severity/location/fix, and summary.

Focus on real, exploitable issues. Don't flag theoretical concerns that the framework already mitigates.
