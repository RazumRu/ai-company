// Dynamic import to avoid CJS/ESM incompatibility when loaded by Cypress config.
// @hey-api/openapi-ts is ESM-only and cannot be statically required in CJS contexts.
export const generateClient = async ({ url, output }) => {
  const { createClient } = await import('@hey-api/openapi-ts');

  await createClient({
    input: url,
    logs: {
      level: 'silent',
    },
    output: {
      path: output,
      lint: 'eslint',
      format: 'prettier',
    },
    plugins: [
      '@hey-api/sdk',
      {
        name: '@hey-api/schemas',
        type: 'form',
      },
      {
        name: '@hey-api/typescript',
        enums: 'typescript',
      },
      '@hey-api/client-axios',
    ],
  });
};
