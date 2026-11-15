// @vitest-environment jsdom

import {
  type InfiniteData,
  QueryClient,
  QueryClientProvider,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import { createElement } from 'react';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

const endpoint = defineRpcEndpoint('/rpc', {
  count: { output: z.number() },
  echo: { input: z.object({ title: z.string() }), output: z.string() },
  add: { kind: 'mutation', input: z.number(), output: z.number() },
  list: {
    kind: 'infinite',
    input: z.object({ cursor: z.number(), filter: z.string() }),
    output: z.object({
      results: z.array(z.string()),
      nextCursor: z.number().nullable(),
    }),
  },
  simpleList: {
    kind: 'infinite',
    input: z.object({ cursor: z.number() }),
    output: z.object({ nextCursor: z.number().nullable() }),
  },
});

afterEach(cleanup);

const mount = async (consume: () => void, client: QueryClient) => {
  const Component = () => {
    consume();
    return null;
  };
  await act(async () => {
    render(
      createElement(QueryClientProvider, { client }, createElement(Component)),
    );
  });
};

const until = async (assertion: () => void) => {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assertion();
  });
};

it('accepts options directly for omitted-input contracts and retains positional calls', async () => {
  const endpoint = defineRpcEndpoint('/rpc', { count: { output: z.number() } });
  const app = new Hono();
  const handler = vi.fn(() => 42);
  mountHono(app, endpoint, { count: handler });
  const { useCountQuery } = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  await mount(() => {
    useCountQuery({ enabled: false });
    useCountQuery(undefined, { enabled: false }, client);
  }, client);
  expect(handler).not.toHaveBeenCalled();
  let selected: string | undefined;
  let legacy: number | undefined;
  await mount(() => {
    selected = useCountQuery({ select: (value) => String(value) }, client).data;
    legacy = useCountQuery(undefined, undefined, client).data;
  }, client);
  await until(() => {
    expect(selected).toBe('42');
    expect(legacy).toBe(42);
  });
  expect(handler).toHaveBeenCalledOnce();
  cleanup();
  client.clear();
});

it('supports schema-defined nullable string cursors in generated hooks and manual options', async () => {
  const custom = defineRpcEndpoint('/rpc', {
    search: {
      kind: 'infinite',
      input: z.object({ cursor: z.string().nullable() }),
      output: z.object({ nextCursor: z.string().nullable() }),
    },
  });
  const inputs: (string | null)[] = [];
  const app = new Hono();
  mountHono(app, custom, {
    search: ({ cursor }) => {
      inputs.push(cursor);
      return { nextCursor: cursor === null ? 'second' : null };
    },
  });
  const queries = createQueries(custom, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  await client.infiniteQuery(
    queries.search.infiniteOptions({
      input: (cursor: string | null) => ({ cursor }),
      initialPageParam: null,
      getNextPageParam: (page) => page.nextCursor,
    }),
  );
  let query!: UseInfiniteQueryResult<
    InfiniteData<{ nextCursor: string | null }, string | null>
  >;
  await mount(() => {
    query = queries.useSearchInfiniteQuery(undefined, {
      initialPageParam: null,
    });
    void query.data;
  }, client);
  await until(() => expect(query.isSuccess).toBe(true));
  expect(inputs).toEqual([null]);
  await act(async () => {
    await query.fetchNextPage();
  });
  await until(() => expect(query.data?.pageParams).toEqual([null, 'second']));
  expect(inputs).toEqual([null, 'second']);
  expect(query.hasNextPage).toBe(false);
  cleanup();
  client.clear();
});

it('exports stable typed hooks and shares query cache keys with manual rpc options', async () => {
  const app = new Hono();
  const handler = vi.fn(async () => 42);
  mountHono(app, endpoint, {
    count: handler,
    echo: async ({ title }) => title,
    add: async (value) => value + 1,
    list: async () => ({ results: [], nextCursor: null }),
    simpleList: async () => ({ nextCursor: null }),
  });
  const hooks = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  await client.query(hooks.count.queryOptions());
  const selected = vi.fn();
  await mount(() => {
    const query = hooks.useCountQuery({
      select: (count) => `Count: ${count}`,
    });
    expectTypeOf(query.data).toEqualTypeOf<string | undefined>();
    selected(query.data);
  }, client);
  expect(selected).toHaveBeenLastCalledWith('Count: 42');
  expect(handler).toHaveBeenCalledOnce();
  expect(hooks.useCountQuery).toBe(hooks.useCountQuery);
  client.clear();
});

it('supports mutation variables, callbacks, errors and explicit invalidation', async () => {
  let count = 0;
  const app = new Hono();
  mountHono(app, endpoint, {
    count: async () => count,
    echo: async ({ title }) => title,
    add: async (value) => {
      if (value < 0) throw new Error('private');
      count += value;
      return count;
    },
    list: async () => ({ results: [], nextCursor: null }),
    simpleList: async () => ({ nextCursor: null }),
  });
  const {
    count: countQueries,
    useCountQuery,
    useAddMutation,
  } = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const success = vi.fn();
  let mutation!: ReturnType<typeof useAddMutation>;
  let data: number | undefined;
  await mount(() => {
    data = useCountQuery().data;
    mutation = useAddMutation({
      onSuccess: async (result) => {
        success(result);
        await client.invalidateQueries({ queryKey: countQueries.key() });
      },
    });
  }, client);
  await until(() => expect(data).toBe(0));
  await act(async () => {
    expect(await mutation.mutateAsync(3)).toBe(3);
  });
  await until(() => expect(data).toBe(3));
  expect(success).toHaveBeenCalledWith(3);
  await act(async () => {
    await expect(mutation.mutateAsync(-1)).rejects.toThrow();
  });
  await until(() => expect(mutation.isError).toBe(true));
  client.clear();
});

it('paginates using contract metadata, preserves filters and accepts overrides', async () => {
  const inputs: unknown[] = [];
  const app = new Hono();
  mountHono(app, endpoint, {
    count: async () => 0,
    echo: async ({ title }) => title,
    add: async (value) => value,
    list: async (input) => {
      inputs.push(input);
      return {
        results: [`${input.filter}:${input.cursor}`],
        nextCursor: input.cursor === 0 ? 2 : null,
      };
    },
    simpleList: async () => ({ nextCursor: null }),
  });
  const hooks = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let query!: UseInfiniteQueryResult<
    InfiniteData<{ results: string[]; nextCursor: number | null }, number>
  >;
  await mount(() => {
    query = hooks.useListInfiniteQuery({ filter: 'todo' });
    // Consume data during render, as a component does, to subscribe to page changes.
    void query.data;
  }, client);
  await until(() => expect(query.isSuccess).toBe(true));
  await act(async () => {
    const result = await query.fetchNextPage();
    expect(result.data?.pages).toHaveLength(2);
  });
  await until(() => {
    expect(query.error).toBeNull();
    expect(query.data?.pages).toHaveLength(2);
  });
  expect(inputs).toEqual([
    { filter: 'todo', cursor: 0 },
    { filter: 'todo', cursor: 2 },
  ]);
  expect(query.hasNextPage).toBe(false);
  expect(
    client.getQueryData(
      hooks.list.infiniteKey({
        input: (cursor: number) => ({ filter: 'todo', cursor }),
        initialPageParam: 0,
      }),
    ),
  ).toEqual(query.data);
  let override!: UseInfiniteQueryResult<
    InfiniteData<{ results: string[]; nextCursor: number | null }, number>
  >;
  await mount(() => {
    override = hooks.useListInfiniteQuery(
      { filter: 'override' },
      { initialPageParam: 5, getNextPageParam: () => undefined },
    );
    hooks.useSimpleListInfiniteQuery();
  }, client);
  await until(() => expect(override.isSuccess).toBe(true));
  expect(override.data?.pageParams).toEqual([5]);
  expect(override.hasNextPage).toBe(false);
  client.clear();
});

it('rejects generated name collisions', () => {
  const contract = { output: z.number() };
  expect(() =>
    createQueries(defineRpcEndpoint('/rpc', { foo: contract, Foo: contract })),
  ).toThrow('Duplicate generated hook name: useFooQuery');
  expect(() =>
    createQueries(
      defineRpcEndpoint('/rpc', {
        foo: contract,
        useFooQuery: contract,
      }),
    ),
  ).toThrow('Duplicate generated hook name: useFooQuery');
});

it('uses custom pagination names, automatic schemas and contract initial values', async () => {
  const custom = defineRpcEndpoint('/rpc', {
    search: {
      kind: 'infinite',
      pagination: { input: 'page', next: 'nextPage', initial: 1 },
      input: z.object({ query: z.string() }),
      output: z.object({ items: z.array(z.string()) }),
    },
    offsets: {
      kind: 'infinite',
      pagination: { input: 'offset', next: 'more', initial: 10 },
      output: z.object({}),
    },
  });
  const inputs: unknown[] = [];
  const app = new Hono();
  mountHono(app, custom, {
    search: (input) => {
      inputs.push(input);
      return { items: [input.query], nextPage: input.page === 1 ? 2 : null };
    },
    offsets: ({ offset }) => ({ more: offset === 10 ? 20 : null }),
  });
  const hooks = createQueries(custom, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let query!: UseInfiniteQueryResult<
    InfiniteData<{ items: string[]; nextPage: number | null }, number>
  >;
  let offsets!: UseInfiniteQueryResult<
    InfiniteData<{ more: number | null }, number>
  >;
  await mount(() => {
    query = hooks.useSearchInfiniteQuery({ query: 'example' });
    offsets = hooks.useOffsetsInfiniteQuery();
    void query.data;
    void offsets.data;
    expectTypeOf(query.data).toEqualTypeOf<
      | InfiniteData<{ items: string[]; nextPage: number | null }, number>
      | undefined
    >();
  }, client);
  await until(() => {
    expect(query.isSuccess).toBe(true);
    expect(offsets.isSuccess).toBe(true);
  });
  await act(async () => {
    await query.fetchNextPage();
    await offsets.fetchNextPage();
  });
  await until(() => {
    expect(query.hasNextPage).toBe(false);
    expect(
      client.getQueryData(
        hooks.search.infiniteKey({
          input: (page: number) => ({ query: 'example', page }),
          initialPageParam: 1,
        }),
      ),
    ).toEqual(query.data);
    expect(offsets.hasNextPage).toBe(false);
  });
  expect(inputs).toEqual([
    { query: 'example', page: 1 },
    { query: 'example', page: 2 },
  ]);
  expect(query.data?.pageParams).toEqual([1, 2]);
  expect(offsets.data?.pageParams).toEqual([10, 20]);
  cleanup();
  client.clear();
});
