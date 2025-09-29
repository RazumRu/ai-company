import { createClient } from '@hey-api/openapi-ts';

export const generateClient = async ({
  url,
  output,
}: {
  url: string;
  output: string;
}) => {
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
