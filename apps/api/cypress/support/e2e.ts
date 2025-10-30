Cypress.Commands.add('validateSchema', (data, schema) => {
  cy.task('validateSchema', { data, schema }).then((result: unknown) => {
    const { errorMsg } = result as { errorMsg: string };
    if (errorMsg) {
      throw new Error(`${errorMsg}. Initial data: ${JSON.stringify(data)}`);
    }
  });
});
