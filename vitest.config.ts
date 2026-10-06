import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const entries = {
  client: 'client',
  endpoint: 'endpoint',
  server: 'server',
  handler: 'handlers/fetch',
  node: 'handlers/node',
  hono: 'adapters/servers/hono',
  fastify: 'adapters/servers/fastify',
  ky: 'adapters/transports/ky',
  axios: 'adapters/transports/axios',
};
export default defineConfig({
  resolve: {
    alias: {
      ...Object.fromEntries(
        Object.entries(entries).map(([entry, source]) => [
          `orpc-stack/${entry}`,
          fileURLToPath(new URL(`./src/${source}.ts`, import.meta.url)),
        ]),
      ),
      'orpc-stack': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts', 'src/index.ts'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
        perFile: true,
      },
    },
  },
});
