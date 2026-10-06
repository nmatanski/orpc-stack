import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import { defineRpcProcedure } from 'orpc-stack/server';
import { expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

it('parses handler input and transforms server output once with an independent client validator', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    date: {
      input: z.string().transform((value) => new Date(value)),
      output: z.string().transform((value) => new Date(value)),
      responseValidator: z.date(),
    },
    suffix: {
      output: z.string().transform((value) => `${value}!`),
      responseValidator: z.string(),
    },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    date: defineRpcProcedure(async (input) => {
      expectTypeOf(input).toEqualTypeOf<Date>();
      return input.toISOString();
    }, endpoint.procedures.date),
    suffix: defineRpcProcedure(
      async () => 'example',
      endpoint.procedures.suffix,
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  const result = await queries.date.call('2026-01-01T00:00:00.000Z');
  expectTypeOf(result).toEqualTypeOf<Date>();
  expect(result).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  expect(await queries.suffix.call()).toBe('example!');
});

it('supports asynchronous output transforms with native oRPC output semantics', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    length: { output: z.string().transform(async (value) => value.length) },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    length: defineRpcProcedure(
      async () => 'example',
      endpoint.procedures.length,
    ),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  expectTypeOf(await queries.length.call()).toEqualTypeOf<number>();
  expect(await queries.length.call()).toBe(7);
  const response = await app.request('/rpc/length', { method: 'POST' });
  expect(await response.json()).toEqual({ json: 7 });
});

it('does not leak fields stripped by the output schema', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    value: { output: z.object({ count: z.number() }) },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    value: defineRpcProcedure(
      async () => ({ count: 42, privateValue: 'secret' }),
      endpoint.procedures.value,
    ),
  });
  const response = await app.request('/rpc/value', { method: 'POST' });
  expect(await response.json()).toEqual({ json: { count: 42 } });
});

it('uses responseValidator only to validate and preserves the original response', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    count: {
      output: z.number(),
      responseValidator: z.number().transform(() => 99),
    },
  });
  const app = new Hono();
  mountHono(app, endpoint, {
    count: defineRpcProcedure(async () => 42, endpoint.procedures.count),
  });
  const queries = createQueries(endpoint, {
    origin: 'http://localhost',
    fetch: async (request) => app.request(request),
  });
  expect(await queries.count.call()).toBe(42);
});
