import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import {
  defineRpcEndpoint,
  defineUncheckedRpcContract,
} from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import { defineUncheckedRpcProcedure } from 'orpc-stack/server';
import { expect, it, vi } from 'vitest';

const contracts = {
  facts: defineUncheckedRpcContract<undefined, { title: string }>(),
};
const api = {
  facts: defineUncheckedRpcProcedure(async () => ({ title: 'Example' })),
};

it('uses one endpoint definition for mounting, URL construction, and cache keys without evaluating browser globals', async () => {
  const endpoint = defineRpcEndpoint('/api/example/rpc', contracts);
  const host = new Hono();
  mountHono(host, endpoint, api);
  const transport = vi.fn(async (request: Request) => host.request(request));
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: transport,
  });
  expect(transport).not.toHaveBeenCalled();
  expect(await queries.facts.call()).toEqual({ title: 'Example' });
  expect(transport.mock.calls[0]?.[0].url).toBe(
    'http://localhost/api/example/rpc/facts',
  );
  const other = createQueries(defineRpcEndpoint('/api/other/rpc', contracts), {
    origin: 'http://localhost',
  });
  expect(queries.facts.queryOptions().queryKey).not.toEqual(
    other.facts.queryOptions().queryKey,
  );
  const external = createQueries(endpoint, {
    origin: 'https://external.example',
  });
  expect(queries.facts.queryOptions().queryKey).not.toEqual(
    external.facts.queryOptions().queryKey,
  );
});

it('requires an explicit origin only when making requests outside a browser', async () => {
  const queries = createQueries(
    defineRpcEndpoint('/api/example/rpc', contracts),
  );
  expect(queries.facts.queryOptions()).toHaveProperty('queryKey');
  await expect(queries.facts.call()).rejects.toThrow('origin');
});

it.each([
  '/',
  '/api/',
  '//external.example',
  '/api?query=x',
  '/api#fragment',
  '/api/*',
])('rejects endpoint paths with ambiguous mount semantics: %s', (path) => {
  if (!path.startsWith('/')) throw new Error('Expected an absolute path');
  expect(() => defineRpcEndpoint(`/${path.slice(1)}`)).toThrow();
});
