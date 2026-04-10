---
id: js-agent
name: JavaScript/TypeScript Agent
description: Instructions for agents working with JavaScript and TypeScript codebases
---

## Type Safety

- Never use `any`. Use specific types, generics, or `unknown` with type guards. `any` disables all type checking downstream and hides real design problems.
- `as T` type assertions are a warning sign — they mean the types don't fit. Fix the type model instead. `as unknown as T` (double-casting) is always wrong; it bypasses the type system entirely and must be removed.
- Derive types from schema definitions via inference (e.g. `z.infer<typeof Schema>`) rather than duplicating type shapes manually. Duplication causes drift.
- Use `null` for absent values on nullable fields. Use `?` only for properties that are genuinely optional, not as a workaround for missing values.

---

## Module System

- Use ESM `import`/`export` syntax. Avoid CommonJS `require()` unless the target environment explicitly requires it.
- Keep all imports at the top of the file. Never use inline `require()` inside functions or closures — it hides dependencies and breaks tree-shaking.

---

## Error Handling

- Always `return await` async calls — never bare `return somePromise()`. Bare returns drop the caller from stack traces, making errors hard to debug.
- Handle errors explicitly at the boundary where recovery is possible. Empty `catch` blocks are forbidden — they silently discard failure information.
- Prefer typed custom error classes over generic `Error` when callers need to distinguish error types.
- For unexpected errors, log enough context to reproduce the issue, then re-throw or surface to the caller.

---

## Control Flow and Readability

- Avoid nested ternaries. For two or more conditions, use `if/else` chains or `switch` — nested ternaries are hard to read and easy to misread.
- Remove dead code immediately. Leftover unused functions, commented-out blocks, and half-refactored structures that mix old and new patterns must be cleaned up — they mislead future readers about intent.
- Remove comments that restate what the code does. Keep comments that explain *why* a non-obvious decision was made. Code should be self-explanatory; comments fill the gaps it cannot fill.

---

## Design Simplicity

- Choose the simplest structure that solves the problem. A plain function is better than a class; a class is better than an abstract class with a factory. Add abstraction layers only when they eliminate real duplication or manage genuine complexity.
- Do not introduce new libraries without strong justification. Every new dependency adds upgrade burden, potential security surface, and bundle weight. Prefer standard library and existing project dependencies first.

---

## Boundary vs. Internal Logic

- Validate all incoming data at the entry boundary (controller, API route, queue consumer) before it reaches business logic. Never re-validate the same data deeper in the stack — that signals the boundary isn't doing its job.
- Keep business logic out of boundary code. Controllers route and validate; services decide. Mixing them makes both harder to test and change independently.

---

## Testing

- Write unit tests alongside source files (`feature.spec.ts` next to `feature.ts`).
- Use the project's configured test scripts — check the repository instruction file for the exact commands. Never invoke test runners (e.g. `vitest`, `jest`) directly.
- Mock external dependencies and I/O; assert observable behaviour, not internal implementation details.
- All existing tests must continue to pass; new code must have corresponding tests.

---

## Linting and Formatting

- Run the project's lint and format scripts before finishing any task. Check the repository instruction file for the exact commands.
- Fix all lint errors. Never add `eslint-disable` comments without an accompanying comment that explains why suppression is justified.
- Zero lint errors and consistent formatting are required before declaring any task complete.

---

## Package Management

- Use whichever package manager is already configured in the repository — check `package.json` or the lock file (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`).
- Add or update dependencies only via the package manager CLI. Never hand-edit version strings in `package.json`.

---

## Framework-Specific Rules

### React / Next.js
- Co-locate component tests with the component file.
- Keep components pure and free of side effects in render paths.
- Never use `dangerouslySetInnerHTML` with unvalidated user input — this is an XSS vector.

### Node.js / Express / Fastify
- Return structured error responses; never expose raw stack traces or internal error messages to clients.

### NestJS
- Follow the Controller → Service → DAO/Repository layered pattern.
- Keep controllers thin: routing and input validation only. Business logic belongs in services.

---

## File Conventions

| File type | Extension |
|---|---|
| TypeScript (Node/server) | `.ts` |
| TypeScript (React components) | `.tsx` |
| Unit tests | `*.spec.ts` |
| Integration / E2E tests | `*.int.ts` or `*.e2e.ts` |

Do not modify configuration files (`tsconfig.json`, `.eslintrc.*`, `prettier.config.*`) without first understanding the project's conventions and confirming the change is intentional.

---

## Quality Gate (run before finishing any task)

1. TypeScript compiles with no errors.
2. All unit tests pass.
3. Lint and formatting checks pass with zero errors.
4. No `any` types, double-casts (`as unknown as T`), suppressed lint rules, or swallowed errors introduced.
5. No dead code, unnecessary comments, or half-refactored structures left behind.
