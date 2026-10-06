import { ORPCError } from '@orpc/server';
import { Hono } from 'hono';
import { createQueries } from 'orpc-stack/client';
import {
  defineRpcEndpoint,
  defineUncheckedRpcContract,
} from 'orpc-stack/endpoint';
import { mountHono } from 'orpc-stack/hono';
import { defineRpcApi, defineRpcProcedure } from 'orpc-stack/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('endpoint function binding', () => {
  it('supports explicitly unchecked contracts', async () => {
    const endpoint = defineRpcEndpoint('/rpc', {
      count: defineUncheckedRpcContract<undefined, number>(),
    });
    const app = new Hono();
    mountHono(app, endpoint, { count: async () => 42 });
    const queries = createQueries(endpoint, {
      origin: 'https://example.test',
      fetch: async (request) => app.request(request),
    });
    expect(await queries.count.call()).toBe(42);
  });

  it('preserves prepared procedures', () => {
    const endpoint = defineRpcEndpoint('/rpc', {
      count: { output: z.number() },
    });
    const count = defineRpcProcedure(() => 2, endpoint.procedures.count);
    expect(defineRpcApi(endpoint, { count }).count).toBe(count);
  });
  it('rejects unknown functions and invalid implementations', () => {
    const endpoint = defineRpcEndpoint('/rpc', {
      count: { output: z.number() },
    });
    expect(() =>
      // @ts-expect-error unknown procedure
      defineRpcApi(endpoint, { count: () => 1, extra: () => 1 }),
    ).toThrow('Missing RPC contract: extra');
    // @ts-expect-error invalid implementation
    expect(() => defineRpcApi(endpoint, { count: 1 })).toThrow(
      'Invalid RPC implementation: count',
    );
  });

  it('binds existing functions and applies schema transforms once', async () => {
    const endpoint = defineRpcEndpoint('/rpc', {
      count: {
        input: z.string().transform(Number),
        output: z.number().transform(String),
      },
    });
    const app = new Hono();
    mountHono(app, endpoint, { count: (input) => input + 1 });
    const queries = createQueries(endpoint, {
      origin: 'https://example.test',
      fetch: async (request) => app.request(request),
    });
    expect(await queries.count.call('4')).toBe('5');
  });

  it('rejects missing implementations at registration', () => {
    const endpoint = defineRpcEndpoint('/rpc', {
      count: { output: z.number() },
    });
    // @ts-expect-error missing implementation
    expect(() => defineRpcApi(endpoint, {})).toThrow(
      'Missing RPC implementation: count',
    );
  });
});

const inferenceEndpoint = defineRpcEndpoint('/rpc', {
  count: {
    input: z.string().transform(Number),
    output: z.number().transform(String),
  },
});
const verifyInference = () => {
  // @ts-expect-error handler receives the parsed number
  defineRpcApi(inferenceEndpoint, { count: (input: string) => input.length });
  // @ts-expect-error handler must return a number before the output transform
  defineRpcApi(inferenceEndpoint, { count: () => 'wrong' });
  // @ts-expect-error mounting must enforce the same contract
  mountHono(new Hono(), inferenceEndpoint, { count: () => 'wrong' });
};
void verifyInference;

it('maps plain handler failures through mounting options', async () => {
  const endpoint = defineRpcEndpoint('/rpc', { count: { output: z.number() } });
  const app = new Hono();
  mountHono(
    app,
    endpoint,
    {
      count: async () => {
        throw new Error('private');
      },
    },
    {
      mapHandlerError: () =>
        new ORPCError('SERVICE_UNAVAILABLE', { message: 'public' }),
    },
  );
  const queries = createQueries(endpoint, {
    origin: 'https://example.test',
    fetch: async (request) => app.request(request),
  });
  await expect(queries.count.call()).rejects.toMatchObject({
    code: 'SERVICE_UNAVAILABLE',
    message: 'public',
  });
});
