# TypeScript Style

## Types

- Never use `any`. Use specific types, generics, or `unknown` + type guards.
- Publicly shared interfaces/types go in `.types.ts` files (one per feature), not inline in implementation files. Private helper types local to a single file are fine inline.
- Nullable columns/fields: use `T | null` (not `T | undefined`) to match DB/JSON semantics. Use `?` for truly optional properties.
- Use `z.infer<typeof Schema>` to derive types from Zod schemas rather than duplicating shapes.

## Control Flow

- Always use braces for `if`/`else`/`for`/`while` — even single-line bodies.
- Always `return await` async calls (not bare `return somePromise()`). This ensures stack traces include the caller.
- Validate inputs early, return/throw early. Avoid deep nesting.

## File Organization

- `*.types.ts` files contain only types, interfaces, enums, and constants. Never put functions in types files.
- `*.utils.ts` files contain utility/helper functions. If a module needs shared helpers, create `<feature>.utils.ts` in the same directory.
- Class files (services, controllers, DAOs) contain only the class. Never put standalone functions in class files.

## Code Quality

- No inline imports (`require()` inside functions). All imports at the top of the file.
- No `// eslint-disable` unless there is a comment explaining why.
- Prefer code over comments. Remove comments that restate what code does. Keep comments that explain *why*.
- Naming: PascalCase for classes/interfaces/enums/types; camelCase for variables/functions; PascalCase for enum members.
