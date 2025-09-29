Cypress.Commands.add('validateSchema', (data, schema) => {
  cy.task('validateSchema', { data, schema }).then(({ errorMsg }: any) => {
    if (errorMsg) {
      throw new Error(`${errorMsg}. Initial data: ${JSON.stringify(data)}`);
    }
  });
});
