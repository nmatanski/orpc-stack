import { call } from '@orpc/server';
import { QueryClient } from '@tanstack/query-core';
import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import {
  definePaginatedRpcProcedure,
  paginate,
  paginateArray,
} from 'orpc-stack/server';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('paginates without mutating arrays and terminates correctly', () => {
  const items = [1, 2, 3];
  expect(paginateArray(items, { cursor: 0, pageSize: 2 })).toEqual({
    results: [1, 2],
    total: 3,
    nextCursor: 2,
  });
  expect(paginateArray(items, { cursor: 2, pageSize: 2 })).toEqual({
    results: [3],
    total: 3,
    nextCursor: null,
  });
  expect(paginateArray(items, { cursor: 10, pageSize: 2 })).toEqual({
    results: [],
    total: 3,
    nextCursor: null,
  });
  expect(paginateArray([], { cursor: 0, pageSize: 2 })).toEqual({
    results: [],
    total: 0,
    nextCursor: null,
  });
  expect(items).toEqual([1, 2, 3]);
});
it.each([
  { cursor: -1, pageSize: 2 },
  { cursor: 0.5, pageSize: 2 },
  { cursor: 0, pageSize: 0 },
  { cursor: 0, pageSize: Infinity },
])('rejects invalid pagination %j', (options) => {
  expect(() => paginateArray([], options)).toThrow(RangeError);
});
it('turns an existing array function into an infinite query', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      input: z.object({
        cursor: z.number().int().nonnegative(),
        query: z.string(),
      }),
      output: z.object({
        results: z.array(z.number()).nullable(),
        total: z.number(),
        nextCursor: z.number().nullable(),
      }),
    },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    list: definePaginatedRpcProcedure(
      async ({ query }) => (query ? [1, 2, 3] : null),
      { ...endpoint.procedures.list, pageSize: 2 },
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'https://example.test',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient();
  const pages = await client.fetchInfiniteQuery({
    ...queries.list.infiniteOptions({
      input: (cursor: number) => ({ cursor, query: 'yes' }),
      initialPageParam: 0,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
    pages: 2,
  });
  expect(pages.pages.map((page) => page.results)).toEqual([[1, 2], [3]]);
  expect(await queries.list.call({ query: '', cursor: 0 })).toEqual({
    results: null,
    total: 0,
    nextCursor: null,
  });
  client.clear();
});

const verifyPaginationTypes = () => {
  const input = z.object({ cursor: z.number(), query: z.string() });
  const output = z.object({
    results: z.array(z.number()),
    total: z.number(),
    nextCursor: z.number().nullable(),
  });
  definePaginatedRpcProcedure(async () => [1, 2], { input, output });
  // @ts-expect-error array items must match the output contract
  definePaginatedRpcProcedure(async () => ['wrong'], { input, output });
  definePaginatedRpcProcedure(async () => [1], {
    // @ts-expect-error pagination requires a parsed cursor
    input: z.object({ query: z.string() }),
    output,
  });
};
void verifyPaginationTypes;

it('defaults to twenty items and preserves output transforms', async () => {
  const procedure = definePaginatedRpcProcedure(
    async () => Array.from({ length: 21 }, (_, index) => index),
    {
      input: z.object({ cursor: z.number() }),
      output: z.object({
        results: z.array(z.number().transform(String)),
        total: z.number(),
        nextCursor: z.number().nullable(),
      }),
    },
  );
  const first = await call(procedure, { cursor: 0 });
  expect(first.results).toHaveLength(20);
  expect(first.results[0]).toBe('0');
  expect(first.nextCursor).toBe(20);
});
it('validates page size before invoking the service and maps service errors', async () => {
  const options = {
    input: z.object({ cursor: z.number() }),
    output: z.object({
      results: z.array(z.number()),
      total: z.number(),
      nextCursor: z.number().nullable(),
    }),
  };
  expect(() =>
    definePaginatedRpcProcedure(async () => [1], { ...options, pageSize: 0 }),
  ).toThrow(RangeError);
  const procedure = definePaginatedRpcProcedure(
    async () => {
      throw new Error('private');
    },
    {
      ...options,
      mapHandlerError: () => new Error('public'),
    },
  );
  await expect(call(procedure, { cursor: 0 })).rejects.toThrow('public');
});

it('binds paginated plain functions using endpoint schemas', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      input: z.object({
        query: z.string(),
        cursor: z.string().transform(Number),
      }),
      output: z.object({
        results: z.array(z.number().transform(String)),
        total: z.number(),
        nextCursor: z.number().nullable(),
      }),
    },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    list: paginate(
      async ({ query }: { query: string }) => (query ? [1, 2, 3] : []),
      { pageSize: 2 },
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'https://example.test',
    fetch: async (request) => app.request(request),
  });
  expect(await queries.list.call({ query: 'example', cursor: '2' })).toEqual({
    results: ['3'],
    total: 3,
    nextCursor: null,
  });
});
it('handles defaults, null and invalid cursors in plain pagination', async () => {
  expect(await paginate(async () => null)({ cursor: 0 })).toEqual({
    results: null,
    total: 0,
    nextCursor: null,
  });
  expect(await paginate(async () => [1])({ cursor: 0 })).toEqual({
    results: [1],
    total: 1,
    nextCursor: null,
  });
  expect(() => paginate(async () => [], { pageSize: 0 })).toThrow(RangeError);
  await expect(paginate(async () => [])({ cursor: -1 })).rejects.toThrow(
    RangeError,
  );
});
