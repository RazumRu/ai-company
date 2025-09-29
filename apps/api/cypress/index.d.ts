declare namespace Cypress {
  interface Chainable {
    validateSchema(data: unknown, schema: object): Chainable<void>;
  }
}
