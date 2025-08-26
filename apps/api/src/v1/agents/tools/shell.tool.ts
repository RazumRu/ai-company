import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { BaseRuntime } from '../../runtime/services/base-runtime';
import { AgentTool } from '../agents.types';

const ShellParamsSchema = z.object({
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  workdir: z.string().optional(),
  env: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
});

export const getShellTool: AgentTool = (runtime?: BaseRuntime) =>
  tool(
    async (args) => {
      const data = ShellParamsSchema.parse(args);

      if (!runtime) throw new Error('Runtime is not set');

      const env =
        data.env && Object.fromEntries(data.env.map((v) => [v.key, v.value]));

      const res = await runtime.exec({ ...data, env });

      return res;
    },
    {
      name: 'shell',
      description:
        'Executes arbitrary shell commands inside the prepared Docker runtime. Use it for files, git, tests, builds, installs, inspection. Returns stdout, stderr, exitCode.',
      schema: ShellParamsSchema,
    },
  );
