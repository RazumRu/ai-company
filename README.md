# Ai company

## Usage

We are using `Node 22.x`!

## Install Dependencies
Run `pnpm install` - this will install all dependencies in the root and in all packages.

To run the necessary dependencies, run the `pnpm run deps:up` command - it will start the containers with the database and so on.
You need to run it only once - when you start your work.

In order to run the application in development mode (with automatic reloading when any changes are applied),
you can use one of these methods:
- run `pnpm run start:dev` in application dir
- run `turbo run start:dev --filter="*dmp-api"` in root dir

To compile and run in production you can run `pnpm run build:all` and then `node ./apps/$appname/dist/main.js` in app dir.

Each application contains env variables that can be configured for each environment separately in files `environment.ts`.
Also, you can replace some variables by created `.env` file

## Tests

Unit or integration tests can be written for each package.
For unit tests we use `vitest`, for integration `cypress`.
To run tests in each package, you can find commands `test:*` or `test:e2e:*`.

For integration tests, you can customize the environment config on the passed special variable.
For example, you can set up different configuration files to run tests on the local environment and on production.

## Commitizen
For generate commits you can use `pnpm commit` command. 

## Docker

You can use docker and docker-compose for applications (podman).

For example, you can run this command from the root dir `podman build -f ./apps/$appname/Dockerfile -t $appname:latest .`
and then `podman run $appname:latest`

Example: `podman build -f ./apps/api/Dockerfile -t api:latest .`
`podman run api:latest`

## DB
We use `TypeOrm`. Automatic synchronization is disabled in order to avoid production errors.
Instead, you should generate migrations each time, which will run automatically when the server starts.

`pnpm run migration:create {name}` - creates migration in `src/db/migrations` dir
`pnpm run migration:generate {name}` - generate migration based on current entities, {name} should be replaced with some comment, like: add-date-field-to-transactions-table
`pnpm run migration:revert` - revert last migration

### Database Seeding

We also support database seeding to populate tables with initial data:

`pnpm run seed:create {name}` - creates a timestamped seed file in `src/db/seeds` dir
`pnpm run seed:run-all` - runs all seed files in order of their timestamps

Locally for each service we can create different db. Postgres create it automatically, you just need update `DATABASES` env in `docker-compose`

## Email Notifications

The API includes an email notification system using AWS SES (Simple Email Service). After a successful checkout, an order confirmation email is automatically sent to the customer.

### Configuration

To enable email notifications, you need to configure the following environment variables:

```
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
EMAIL_SENDER=noreply@example.com
```

These variables can be set in the `.env` file or in your deployment environment.

### Email Module

The email module is located in `src/v1/email` and consists of:

- `EmailService`: Handles sending emails using AWS SES
- `EmailModule`: NestJS module that provides the EmailService

The email service is integrated with the checkout process to send order confirmation emails automatically.

## Notes

### Body arrays

Nest don't support automatic generated validations and swagger definitions for body array https://docs.nestjs.com/openapi/types-and-parameters#arrays.
If you need it - you can use `@ApiBody()` and `CustomArrayValidationPipe`:

```
@Post('release-and-reserve')
  @ApiBody({ type: [ReleaseAndReserveBudgetDto] })
  public releaseAndReserve(
    @Body(new CustomArrayValidationPipe({ items: ReleaseAndReserveBudgetDto }))
    body: ReleaseAndReserveBudgetDto[],
  ): Promise<BudgetReservationDto[]> {
    return this.budgetService.releaseAndReserveBudget(body);
  }
}
```

### Dto query arrays

Note that sometimes server can't properly parse query arrays in some cases (for example, when we doing requests from cypress).
In that case we should use `@TransformQueryArray`:

```
export class GetFilesByIdsDto {
  @IsNumber(undefined, { each: true })
  @IsArray()
  @TransformQueryArray(Number)
  ids: number[];
}
```

Notice, that we use `Number` to convert all values to number, because bu default all values from query parameters it's strings

### Dto int enum definitions

When you're trying to use just `@IsEnum` decorator with int enum - swagger will show you strings.
To fix it you can use custom decorator:

```
@IsEnum(CampaignConnectionType, { each: true })
@ApiEnumProperty({
  enum: CampaignConnectionType,
  enumType: 'number',
  isArray: true,
})
connectionTypes: CampaignConnectionType[];
```
