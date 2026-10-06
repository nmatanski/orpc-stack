import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import {
  defineRpcEndpoint,
  defineUncheckedRpcContract,
} from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import {
  defineRpcProcedure,
  defineUncheckedRpcProcedure,
} from 'orpc-stack/server';
import { expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

it('infers the client from the endpoint and accepts Standard Schema directly', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    facts: {
      input: z.undefined(),
      output: z.object({ title: z.string(), count: z.number().positive() }),
    },
  });
  const host = new Hono();
  mountHono(host, endpoint, {
    facts: defineRpcProcedure(
      async () => ({ title: 'Example', count: 5 }),
      endpoint.procedures.facts,
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => host.request(request),
  });
  const facts = await queries.facts.call();
  expectTypeOf(facts).toEqualTypeOf<{ title: string; count: number }>();
  expect(facts).toEqual({ title: 'Example', count: 5 });
});

it('keeps unchecked registration explicit and shares its types without claiming validation', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    echo: defineUncheckedRpcContract<{ value: number }, { value: number }>(),
  });
  const host = new Hono();
  mountHono(host, endpoint, {
    echo: defineUncheckedRpcProcedure(
      async (input: { value: number }) => input,
      { contract: endpoint.procedures.echo },
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => host.request(request),
  });
  expectTypeOf(await queries.echo.call({ value: 5 })).toEqualTypeOf<{
    value: number;
  }>();
  expect(endpoint.procedures.echo.validation).toBe('unchecked');
  const response = await host.request('/rpc/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: { value: 'not a number' } }),
  });
  expect(await response.json()).toEqual({ json: { value: 'not a number' } });
});

it('maps handler errors only, leaving input/output validation failures outside that mapping', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    checked: {
      input: z.object({ value: z.number().positive() }),
      output: z.number().positive(),
    },
  });
  const mapper = vi.fn((error: unknown) =>
    error instanceof Error ? error : new Error('Handler failed'),
  );
  const implementation = vi.fn(async (input: { value: number }) => {
    if (input.value === 2) throw new Error('handler error');
    return -1;
  });
  const host = new Hono();
  mountHono(host, endpoint, {
    checked: defineRpcProcedure(implementation, {
      ...endpoint.procedures.checked,
      mapHandlerError: mapper,
    }),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => host.request(request),
  });
  await expect(queries.checked.call({ value: 0 })).rejects.toThrow();
  expect(implementation).not.toHaveBeenCalled();
  await expect(queries.checked.call({ value: 1 })).rejects.toThrow();
  expect(mapper).not.toHaveBeenCalled();
  await expect(queries.checked.call({ value: 2 })).rejects.toThrow();
  expect(mapper).toHaveBeenCalledOnce();
});

it('maps failures inside explicitly unchecked handlers', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    failure: defineUncheckedRpcContract<undefined, never>(),
  });
  const mapper = vi.fn(() => new Error('mapped handler failure'));
  const host = new Hono();
  mountHono(host, endpoint, {
    failure: defineUncheckedRpcProcedure(
      async () => {
        throw new Error('private');
      },
      {
        contract: endpoint.procedures.failure,
        mapHandlerError: mapper,
      },
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => host.request(request),
  });
  await expect(queries.failure.call()).rejects.toThrow('Internal server error');
  expect(mapper).toHaveBeenCalledOnce();
});

it('defaults an omitted input to validated undefined and infers a no-input client', async () => {
  const definition = { facts: { output: z.object({ title: z.string() }) } };
  const endpoint = defineRpcEndpoint('/rpc', definition);
  const implementation = vi.fn(async () => ({ title: 'Example' }));
  const host = new Hono();
  mountHono(host, endpoint, {
    facts: defineRpcProcedure(implementation, endpoint.procedures.facts),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => host.request(request),
  });
  expectTypeOf(queries.facts.call).parameter(0).toEqualTypeOf<undefined>();
  const result = await queries.facts.call();
  expectTypeOf(result).toEqualTypeOf<{ title: string }>();
  expect(result).toEqual({ title: 'Example' });
  expect(definition.facts).not.toHaveProperty('input');
  implementation.mockClear();
  for (const input of [null, {}, 'unexpected', 42, false]) {
    const response = await host.request('/rpc/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: input }),
    });
    expect(response.status).toBe(400);
  }
  expect(implementation).not.toHaveBeenCalled();
});
