# Zod Schema Conventions

## Union Ordering

`z.union` returns the first member that parses successfully. A member with all-optional fields accepts any object (empty included), making later members unreachable. Unknown keys are stripped by default, so full payloads get silently reduced.

- Put the **most-specific** schema (most required fields) first in `z.union`.
- When two shapes are both structurally valid objects, prefer `z.discriminatedUnion` with an explicit discriminator over order-dependent unions.
- Tests must assert the full shape survives `safeParse`, not just that parsing succeeds.

```ts
// WRONG — partial schema wins every parse, stripping full DTOs
z.union([PartialUpdateSchema, FullDtoSchema]);

// RIGHT — full schema tried first, partial is the fallback
z.union([FullDtoSchema, PartialUpdateSchema]);

// BETTER — explicit discriminator, no ordering gotcha
z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('full'), ...FullDtoSchema.shape }),
  z.object({ mode: z.literal('partial'), ...PartialUpdateSchema.shape }),
]);
```

## Validation Failure Logging

When a payload fails schema validation, do NOT serialise the full payload into logs. The failing input may contain user messages, PII, secrets, or LangChain `BaseMessage` content that reaches Pino/Sentry.

Log only the safe envelope fields and the validation issues themselves:

```ts
const raw = (event ?? {}) as Record<string, unknown>;
this.logger.error(parsed.error, 'Invalid payload — dropping', {
  eventType: raw.type,
  eventKeys: Object.keys(raw),
  envelope: { type: raw.type, graphId: raw.graphId, threadId: raw.threadId },
  issues: parsed.error.issues,
});
```

Never include `data`, `messages`, `metadata`, or any field whose shape is owned by the caller.

## Native Enums over Literal Unions

When a schema field's domain matches an existing TypeScript enum, use `z.nativeEnum(TheEnum)` instead of `z.union([z.literal('A'), z.literal('B'), ...])`. This keeps the schema as the single source of truth and prevents drift when enum members are added.

```ts
// WRONG — drifts when the enum adds a value
status: z.union([
  z.literal('Starting'),
  z.literal('Running'),
  z.literal('Failed'),
]);

// RIGHT
status: z.nativeEnum(RuntimeInstanceStatus);
```

Call sites passing raw string literals must be updated to the enum values (`RuntimeInstanceStatus.Running` instead of `'Running'`).

## DTO Schemas

- All Zod schemas for a module live in a single `dto/<feature>.dto.ts` file.
- Export the schema as `const FooSchema = z.object({...})` and the DTO class as `export class FooDto extends createZodDto(FooSchema) {}`.
- Derive types via `z.infer<typeof FooSchema>` — never duplicate the shape.
