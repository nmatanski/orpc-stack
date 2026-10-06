import Fastify from 'fastify';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountFastify } from 'orpc-stack/fastify';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('serves RPC without altering REST body parsers', async () => {
  const app = Fastify();
  app.post('/rest', async (request) => request.body);
  const endpoint = defineRpcEndpoint('/rpc', {
    count: { input: z.number(), output: z.number() },
  });
  mountFastify(app, endpoint, { count: (value) => value + 1 });
  await app.ready();
  try {
    const queries = createQueries(endpoint, {
      origin: 'http://localhost',
      fetch: async (request) => {
        const response = await app.inject({
          method: 'POST',
          url: new URL(request.url).pathname,
          headers: Object.fromEntries(request.headers),
          payload: await request.text(),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await queries.count.call(2)).toBe(3);
    await expect(queries.count.call(Number.NaN)).rejects.toThrow();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/rest',
          payload: { ok: true },
        })
      ).json(),
    ).toEqual({ ok: true });
    expect(
      (await app.inject({ method: 'POST', url: '/rpc/missing', payload: {} }))
        .statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
