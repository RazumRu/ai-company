# @packages/cypress

Simplify your Cypress end-to-end test configuration with ease.

## Installation

Install the package using npm or yarn:

```bash
pnpm install @packages/cypress -D
```

## Configuration

Create a `cypress.config.mjs` file with the following content:

```javascript
import { defineConfig } from 'cypress';
import { setupNodeEvents } from '@packages/cypress';

export default defineConfig({
  video: false,
  screenshotOnRunFailure: false,
  e2e: {
    baseUrl: 'https://site-url.com',
    specPattern: './e2e/**/*.cy.ts',
    setupNodeEvents
  }
});
```

You can extend your TypeScript configuration using tsconfig:

```json
{
  "extends": "@packages/cypress/tsconfig.cy.json",
  "compilerOptions": {
    "types": ["node", "cypress"]
  },
  "include": ["./e2e/**/*.ts"]
}
```

## Usage

Once configured, you can run your Cypress tests as usual. The package handles the rest, ensuring your setup is streamlined and efficient.

## Generate API

When we are using cypress e2e it's better to use types generated directly from OpenAPI.
This package provide command for that, you can add it to package.json: `"test:e2e:generate-api.js": "cy-generate-api.js http://localhost:5000/swagger-api-json cypress/api-definitions && yarn run lint:fix"`.
Just replace it with correct url and output directory.

Also after you may want to add this rule to eslint:
```json
  {
    ignores: ['**/*.gen.ts'],
  }
```
