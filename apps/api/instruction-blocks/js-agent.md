---
id: js-agent
name: JavaScript/TypeScript Agent
description: Instructions for agents working with JavaScript and TypeScript codebases
---

## Type Safety

- Enable and respect TypeScript strict mode. Avoid `any`; use specific types, generics, or `unknown` with type guards.
- Derive types from Zod or other schema definitions using inference (`z.infer<typeof Schema>`) rather than duplicating shapes manually.
- Use `null` for absent values on nullable fields; use optional properties (`?`) only when the field is truly optional.

## Module System

- Use ESM `import`/`export` syntax. Avoid CommonJS `require()` unless the target environment requires it.
- Keep all imports at the top of the file; never use inline `require()` inside functions.

## Error Handling

- Always `return await` async calls — never bare `return somePromise()`. This preserves stack traces.
- Handle errors explicitly; never swallow errors silently. Prefer typed custom error classes over generic `Error`.

## Testing

- Write unit tests alongside source files (e.g. `feature.spec.ts` next to `feature.ts`).
- Use the project's test runner and scripts (check the repository instruction file). Never invoke test runners directly.
- Mock external dependencies; assert behaviour, not implementation details.

## Package Management

- Use the package manager already configured in the repository (`npm`, `yarn`, or `pnpm` — check `package.json` or lock files).
- Add dependencies to `package.json` via the package manager; never edit `package.json` directly for version changes.

## Linting and Formatting

- Run the project's lint and format scripts before finishing any task (check the repository instruction file for the exact command).
- Fix all lint errors; do not add `eslint-disable` comments without an explanatory comment explaining why.

## Common Frameworks

- **React/Next.js**: co-locate component tests, keep components pure, avoid `dangerouslySetInnerHTML`.
- **Node.js/Express/Fastify**: validate all incoming request data at the boundary; never trust unvalidated input.
- **NestJS**: follow the Controller → Service → DAO/Repository layered pattern; keep controllers thin.

## File Conventions

- TypeScript source files: `.ts` (Node/server), `.tsx` (React components).
- Test files: `*.spec.ts` for unit tests, `*.e2e.ts` or `*.int.ts` for integration/end-to-end tests.
- Configuration files: `tsconfig.json`, `.eslintrc.*`, `prettier.config.*` — do not modify these without understanding the project's conventions.
