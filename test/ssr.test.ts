// @vitest-environment jsdom

import { AsyncLocalStorage } from 'node:async_hooks';
import { RPCLink } from '@orpc/client/fetch';
import type { InferRouterInitialContext } from '@orpc/server';
import { createRouterClient, ORPCError, os } from '@orpc/server';
import {
  dehydrate,
  hydrate,
  QueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { act, cleanup, render } from '@testing-library/react';
import { createQueries, createRpcClient } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { createRpcHandler } from 'orpc-stack/handler';
import { defineRpcApi } from 'orpc-stack/server';
import { createElement, Suspense } from 'react';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const endpoint = defineRpcEndpoint('/rpc', {
  facts: { output: z.object({ requestId: z.string() }) },
  list: {
    kind: 'infinite',
    output: z.object({ results: z.array(z.number()) }),
  },
  save: { kind: 'mutation', input: z.number(), output: z.number() },
});

const setup = () => {
  const requests = new AsyncLocalStorage<Request>();
  const middleware = vi.fn();
  const base = os
    .$context<{ headers: Headers }>()
    .use(async ({ context, next }) => {
      middleware(context.headers.get('x-request-id'));
      if (context.headers.get('x-fail') === 'yes')
        throw new ORPCError('SERVICE_UNAVAILABLE');
      await Promise.resolve();
      return next();
    });
  const api = defineRpcApi(endpoint, {
    facts: base
      .input(endpoint.procedures.facts.input)
      .output(endpoint.procedures.facts.output)
      .handler(({ context }) => ({
        requestId: context.headers.get('x-request-id') ?? 'browser',
      })),
    list: base
      .input(endpoint.procedures.list.input)
      .output(endpoint.procedures.list.output)
      .handler(({ input }) => ({
        results: [input.cursor],
        nextCursor: input.cursor === 0 ? 1 : null,
      })),
    save: base
      .input(endpoint.procedures.save.input)
      .output(endpoint.procedures.save.output)
      .handler(({ input }) => input),
  });
  expectTypeOf<InferRouterInitialContext<typeof api>>().toMatchTypeOf<{
    headers: Headers;
  }>();
  const direct = createRouterClient(api, {
    context: () => ({ headers: requests.getStore()?.headers ?? new Headers() }),
  });
  const initialized = vi.fn();
  const contextFactory = vi.fn((request: Request) => ({
    headers: request.headers,
  }));
  const handler = createRpcHandler(api, {
    context: contextFactory,
    plugins: [{ init: initialized }],
    adapterInterceptors: [
      async ({ next }) => {
        const result = await next();
        if (result.matched) result.response.headers.set('x-adapter', 'enabled');
        return result;
      },
    ],
  });
  const fetch = vi.fn(async (request: Request) => {
    const { response } = await handler.handle(request, {
      prefix: endpoint.path,
    });
    return response ?? new Response('Not found', { status: 404 });
  });
  const client = createRpcClient(endpoint, {
    origin: () =>
      new URL(requests.getStore()?.url ?? 'https://example.test').origin,
    headers: () => requests.getStore()?.headers ?? {},
    fetch,
  });
  return {
    requests,
    api,
    direct,
    handler,
    contextFactory,
    initialized,
    middleware,
    fetch,
    client,
  };
};

const queryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
  });
const request = (id: string, fail = false) =>
  new Request('https://example.test/items', {
    headers: { 'x-request-id': id, ...(fail ? { 'x-fail': 'yes' } : {}) },
  });

it('isolates concurrent SSR requests while shared direct clients execute native middleware', async () => {
  const fixture = setup();
  const rpc = createQueries(endpoint, { client: fixture.direct });
  const clients = [queryClient(), queryClient()];
  const results = await Promise.all(
    clients.map((client, index) =>
      fixture.requests.run(request(String(index)), () =>
        rpc.load(client, { facts: {}, list: {} }),
      ),
    ),
  );
  expect(results.map((result) => result.facts.requestId)).toEqual(['0', '1']);
  expect(results[0]?.list.pageParams).toEqual([0]);
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.middleware).toHaveBeenCalledTimes(4);
  for (const client of clients) client.clear();
});

it('hydrates native and generated Suspense hooks with identical browser keys and no initial fetch', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const fixture = setup();
  const server = createQueries(endpoint, {
    client: fixture.direct,
    origin: 'https://example.test',
  });
  const ssr = queryClient();
  await fixture.requests.run(request('ssr'), () =>
    server.load(ssr, { facts: {}, list: {} }),
  );
  const state = JSON.parse(JSON.stringify(dehydrate(ssr)));
  const browser = createQueries(endpoint, { fetch: fixture.fetch });
  expect(server.facts.queryKey()).toEqual(browser.facts.queryKey());
  const client = queryClient();
  hydrate(client, state);
  let fetchNext: (() => Promise<unknown>) | undefined;
  const Component = () => {
    const native = useSuspenseQuery(
      browser.facts.queryOptions({ staleTime: 60_000 }),
    );
    const generated = browser.useFactsSuspenseQuery({ staleTime: 60_000 });
    const legacy = browser.useFactsSuspenseQuery(undefined, {
      staleTime: 60_000,
    });
    const items = browser.useListSuspenseInfiniteQuery(undefined, {
      staleTime: 60_000,
    });
    expectTypeOf(generated.data).toEqualTypeOf<{ requestId: string }>();
    expect(native.data).toEqual(generated.data);
    expect(legacy.data).toEqual(generated.data);
    fetchNext = () => items.fetchNextPage();
    return createElement(
      'div',
      null,
      `${generated.data.requestId}:${items.data.pages.length}`,
    );
  };
  let view: ReturnType<typeof render> | undefined;
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({});
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    loader: ({ context }) =>
      browser.load(context.queryClient, { facts: {}, list: {} }),
    component: Component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient: client },
    scrollRestoration: false,
  });
  setupRouterSsrQueryIntegration({ router, queryClient: client });
  await router.load();
  await act(async () => {
    view = render(
      createElement(
        Suspense,
        { fallback: 'Loading' },
        createElement(RouterProvider, { router }),
      ),
    );
  });
  expect(view?.container.textContent).toBe('ssr:1');
  expect(fixture.fetch).not.toHaveBeenCalled();
  await act(async () => {
    await fetchNext?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(fixture.fetch).toHaveBeenCalledOnce();
  expect(view?.container.textContent).toBe('ssr:2');
  cleanup();
  ssr.clear();
  client.clear();
});

it('supports HTTP SSR headers, supplied links, handler plugins, context overrides and error recovery', async () => {
  const fixture = setup();
  const rpc = createQueries(endpoint, { client: fixture.client });
  const client = queryClient();
  await fixture.requests.run(request('first', true), async () => {
    await expect(rpc.load(client, { facts: {} })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
  const recovered = await fixture.requests.run(request('second'), () =>
    rpc.load(client, { facts: {} }),
  );
  expect(recovered.facts.requestId).toBe('second');
  expect(fixture.contextFactory).toHaveBeenCalledTimes(2);
  expect(fixture.initialized).toHaveBeenCalledOnce();
  const linked = createQueries(endpoint, {
    link: new RPCLink({
      url: 'https://example.test/rpc',
      fetch: fixture.fetch,
    }),
  });
  expect(await linked.facts.call()).toEqual({ requestId: 'browser' });
  const response = await fixture.handler.handle(
    new Request('https://example.test/rpc/facts', { method: 'POST' }),
    {
      prefix: '/rpc',
      context: { headers: new Headers({ 'x-request-id': 'override' }) },
    },
  );
  expect(response.response?.headers.get('x-adapter')).toBe('enabled');
  expect(await response.response?.json()).toMatchObject({
    json: { requestId: 'override' },
  });
  await expect(
    Reflect.apply(rpc.load, rpc, [client, { save: {} }]),
  ).rejects.toThrow('Not a loadable query');
  client.clear();
});

it('passes typed context to plain functions and preserves direct router output types', async () => {
  const onlyFacts = defineRpcEndpoint('/rpc', {
    facts: endpoint.procedures.facts,
  });
  const api = defineRpcApi(onlyFacts, {
    facts: (_input, context: { requestId: string }) => ({
      requestId: context.requestId,
    }),
  });
  const client = createRouterClient(api, { context: { requestId: 'plain' } });
  expectTypeOf(await client.facts()).toEqualTypeOf<{ requestId: string }>();
  expect(await client.facts()).toEqual({ requestId: 'plain' });
});

it('prefetches multiple infinite pages and preserves endpoints named load', async () => {
  const fixture = setup();
  const rpc = createQueries(endpoint, { client: fixture.direct });
  const client = queryClient();
  const result = await rpc.load(client, {
    list: { pages: 2, initialPageParam: 0 },
  });
  expect(result.list.pages).toEqual([
    { results: [0], nextCursor: 1 },
    { results: [1], nextCursor: null },
  ]);
  const custom = defineRpcEndpoint('/custom', { load: { output: z.number() } });
  const existing = createQueries(custom, {
    client: createRouterClient(defineRpcApi(custom, { load: () => 42 })),
  });
  expect(await existing.load(client, { load: {} })).toEqual({ load: 42 });
  expect(await client.query(existing.load.queryOptions())).toBe(42);
  expect(await existing.load.call()).toBe(42);
  client.clear();
});
