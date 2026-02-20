# Geniro API

## Database (TypeORM)
We use TypeORM with migrations (no auto-sync in production). For details and API, see `packages/typeorm/README.md`.

This app exposes scripts you can run via pnpm:

- `pnpm run migration:create {name}` – creates a migration in `src/db/migrations`
- `pnpm run migration:generate {name}` – generates a migration based on current entities
- `pnpm run migration:run` – runs all pending migrations
- `pnpm run migration:revert` – reverts the last migration

### Database Seeding
- `pnpm run seed:create {name}` – creates a timestamped seed file in `src/db/seeds`
- `pnpm run seed:run-all` – runs all seed files in timestamp order

## Testing
See `.guidelines/testing.md` for project-wide testing rules. Always run:
```bash
pnpm run full-check
```
before marking work as done.
