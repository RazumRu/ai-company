---
name: skeptic
description: "Validate an architect specification against the actual codebase. Detects mirages (nonexistent files, functions, packages), verifies requirement coverage (forward+backward traceability), and flags scope creep. Use after /plan to verify the spec before implementation."
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
argument-hint: "[paste architect spec or describe what to validate]"
context: fork
agent: skeptic-agent
---

Validate the following architect specification against the actual Geniro codebase.

## What to Validate

$ARGUMENTS

## Context

The Geniro platform consists of two repositories:
- **geniro/** — NestJS API backend (MikroORM, Vitest, Zod DTOs)
- **geniro/apps/web/** — React frontend (Vite, Ant Design, Refine, Socket.io)

## Your Task

1. **Extract every factual claim** from the specification — file paths, function names, class names, import paths, module references, package dependencies, and pattern references.
2. **Verify each claim** against the actual codebase using Read, Glob, and Grep. Batch verifications for efficiency.
3. **Extract requirements** from the original task description and verify each is covered in the spec (forward traceability). Check each spec step maps to a requirement (backward traceability). Flag dropped requirements and scope creep.
4. **Produce a Skeptic Validation Report** with the standard format: verified claims, mirages found, completeness matrix, warnings, and summary.

Be thorough but efficient. False negatives (missed mirages) are worse than false positives (flagging something that's actually fine).
