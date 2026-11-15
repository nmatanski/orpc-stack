import { ORPCError } from '@orpc/server';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { createNextHandler } from 'orpc-stack/next';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

it('serves typed App Router requests, validates input and returns 404 for unmatched routes', async () => {
  const endpoint = defineRpcEndpoint('/api/rpc', {
    search: {
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    },
  });
  const search = vi.fn(({ query }: { query: string }) => [query]);
  const POST = createNextHandler(endpoint, { search });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => POST(request),
  });
  expect(await queries.search.call({ query: 'example' })).toEqual(['example']);
  expect(search).toHaveBeenCalledOnce();
  const invalid = await POST(
    new Request('http://localhost/api/rpc/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { query: 123 } }),
    }),
  );
  expect(invalid.status).toBe(400);
  expect(search).toHaveBeenCalledOnce();
  for (const path of ['/api/rpc/missing', '/api/other/search']) {
    const response = await POST(
      new Request(`http://localhost${path}`, { method: 'POST' }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  }
});

it('maps handler failures using the same options as other server adapters', async () => {
  const endpoint = defineRpcEndpoint('/api/search', {
    search: { output: z.string() },
  });
  const failure = new Error('upstream is unavailable');
  const mapHandlerError = vi.fn(
    () =>
      new ORPCError('BAD_GATEWAY', {
        message: 'Search is unavailable.',
      }),
  );
  const POST = createNextHandler(
    endpoint,
    {
      search: async () => {
        throw failure;
      },
    },
    { mapHandlerError },
  );
  const response = await POST(
    new Request('http://localhost/api/search/search', { method: 'POST' }),
  );
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    json: { code: 'BAD_GATEWAY', message: 'Search is unavailable.' },
  });
  expect(mapHandlerError).toHaveBeenCalledWith(failure);
});
