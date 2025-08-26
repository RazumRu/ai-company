# Lusora api

## DB
We use `TypeOrm`. Automatic synchronization is disabled in order to avoid production errors.
Instead, you should generate migrations each time, which will run automatically when the server starts.

`yarn migration:create {name}` - creates migration in `src/db/migrations` dir
`yarn migration:generate {name}` - generate migration based on current entities, {name} should be replaced with some comment, like: add-date-field-to-transactions-table
`yarn migration:revert` - revert last migration

### Database Seeding

We also support database seeding to populate tables with initial data:

`yarn seed:create {name}` - creates a timestamped seed file in `src/db/seeds` dir
`yarn seed:run-all` - runs all seed files in order of their timestamps
