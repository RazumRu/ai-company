import 'cypress';

import Ajv, { type AnySchema } from 'ajv';
import addFormats from 'ajv-formats';

export const setupNodeEvents = (
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
) => {
  // any custom logic
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  on('task', {
    validateSchema({ data, schema }: { data: unknown; schema: AnySchema }) {
      const validate = ajv.compile(schema);
      const ok = validate(data);

      return { ok, errorMsg: ok ? undefined : ajv.errorsText(validate.errors) };
    },
  });

  return config;
};

export * from './api-generator';
