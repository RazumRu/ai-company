import 'cypress';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const setupNodeEvents: any = (on: any, config: any) => {
  // any custom logic
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  on('task', {
    validateSchema({ data, schema }: any) {
      const validate = ajv.compile(schema);
      const ok = validate(data);

      return { ok, errorMsg: ok ? undefined : ajv.errorsText(validate.errors) };
    },
  });

  return config;
};

export * from './api-generator';
