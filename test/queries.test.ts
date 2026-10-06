import { QueryClient } from '@tanstack/query-core';
import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import { defineRpcProcedure } from 'orpc-stack/server';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

const pageInput = z.object({ cursor: z.number().int().nonnegative() });
const pageOutput = z.object({
  results: z.array(z.string()),
  nextCursor: z.number().nullable(),
});
const functions = {
  facts: defineRpcProcedure(async () => ({ title: 'Example', count: 5 }), {
    input: z.undefined(),
    output: z.object({ title: z.string(), count: z.number() }),
  }),
  searchPage: defineRpcProcedure(
    async ({ cursor }: z.infer<typeof pageInput>) => ({
      results: [`Example ${cursor}`],
      nextCursor: cursor === 0 ? 1 : null,
    }),
    { input: pageInput, output: pageOutput },
  ),
};

it('connects existing functions to query and infinite-query options through a mounted Hono app', async () => {
  const api = new Hono();
  api.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  mountHono(api, defineRpcEndpoint('/rpc'), functions);
  const host = new Hono().route('/api/example', api);
  const queries = createQueries(
    defineRpcEndpoint('/api/example/rpc', {
      facts: {
        input: z.undefined(),
        output: z.object({ title: z.string(), count: z.number() }),
      },
      searchPage: { input: pageInput, output: pageOutput },
    }),
    {
      origin: 'http://localhost',
      fetch: async (request) => host.request(request),
    },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const facts = await queryClient.fetchQuery(
    queries.facts.queryOptions({ staleTime: 60_000 }),
  );
  expectTypeOf(facts).toEqualTypeOf<{ title: string; count: number }>();
  expect(facts).toEqual({ title: 'Example', count: 5 });
  const options = queries.searchPage.infiniteOptions({
    input: (cursor: number) => ({ cursor }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  await queryClient.fetchInfiniteQuery(options);
  const pages = await queryClient.fetchInfiniteQuery({ ...options, pages: 2 });
  expect(pages.pages).toEqual([
    { results: ['Example 0'], nextCursor: 1 },
    { results: ['Example 1'], nextCursor: null },
  ]);
  expect(
    (
      await host.request('/api/example/rpc/facts', { method: 'POST' })
    ).headers.get('cache-control'),
  ).toBe('no-store');
  expect(
    (await host.request('/api/example/rpc/missing', { method: 'POST' })).status,
  ).toBe(404);
  queryClient.clear();
});

it('validates inputs before invoking functions and maps private failures at the boundary', async () => {
  const handler = vi.fn().mockRejectedValue(new Error('database secret'));
  const report = vi.fn();
  const api = {
    search: defineRpcProcedure(handler, {
      input: pageInput,
      output: pageOutput,
      mapHandlerError: (error) => {
        report(error);
        return new Error('Service unavailable');
      },
    }),
  };
  const host = new Hono();
  mountHono(host, defineRpcEndpoint('/rpc'), api);
  const queries = createQueries(
    defineRpcEndpoint('/rpc', {
      search: { input: pageInput, output: pageOutput },
    }),
    {
      origin: 'http://localhost',
      fetch: async (request) => host.request(request),
    },
  );
  await expect(queries.search.call({ cursor: -1 })).rejects.toThrow();
  expect(handler).not.toHaveBeenCalled();
  await expect(queries.search.call({ cursor: 0 })).rejects.toThrow(
    'Internal server error',
  );
  expect(report).toHaveBeenCalledOnce();
});

it('validates browser responses and carries the cancellation signal to the chosen transport', async () => {
  const controller = new AbortController();
  const transport = vi.fn(async (request: Request) => {
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    return Response.json({ json: { results: [], nextCursor: 'invalid' } });
  });
  const queries = createQueries(
    defineRpcEndpoint('/rpc', {
      searchPage: {
        input: pageInput,
        output: pageOutput,
        responseValidator: pageOutput,
      },
    }),
    {
      origin: 'http://localhost',
      fetch: transport,
    },
  );
  await expect(
    queries.searchPage.call({ cursor: 0 }, { signal: controller.signal }),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledOnce();
});
