import { once } from 'node:events';
import { createServer } from 'node:http';
import { ORPCError, os } from '@orpc/server';
import axios from 'axios';
import { createAxiosTransport } from 'orpc-stack/axios';
import { createQueries } from 'orpc-stack/client';
import {
  defineRpcEndpoint,
  defineUncheckedRpcContract,
} from 'orpc-stack/endpoint';
import { createRpcHandler } from 'orpc-stack/handler';
import { kyTransport } from 'orpc-stack/ky';
import { createNodeRpcHandler } from 'orpc-stack/node';
import {
  defineRpcProcedure,
  defineUncheckedRpcProcedure,
} from 'orpc-stack/server';
import { expect, expectTypeOf, it } from 'vitest';
import { object, string } from 'yup';

it('resolves typed Node handler context per request and accepts handler interceptors', async () => {
  const api = {
    facts: os
      .$context<{ requestId: string }>()
      .handler(({ context }) => context.requestId),
  };
  const handler = createNodeRpcHandler(api, {
    context: (request) => ({
      requestId: String(request.headers['x-request-id']),
    }),
    adapterInterceptors: [
      async ({ response, next }) => {
        response.setHeader('x-adapter', 'enabled');
        return next();
      },
    ],
  });
  const server = createServer((request, response) => {
    void handler
      .handle(request, response)
      .then((result) => {
        if (!result.matched) response.writeHead(404).end();
      })
      .catch(() => response.writeHead(500).end());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing server address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/facts`, {
      method: 'POST',
      headers: { 'x-request-id': 'node-context' },
    });
    expect(response.headers.get('x-adapter')).toBe('enabled');
    expect(await response.json()).toEqual({ json: 'node-context' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('preserves Axios headers and supports bodyless HTTP responses', async () => {
  const client = axios.create({
    adapter: async (config) => {
      expect(config.method).toBe('head');
      expect(config.data).toBeUndefined();
      return {
        config,
        status: 204,
        statusText: 'No Content',
        data: new TextEncoder().encode('ignored').buffer,
        headers: {
          'x-number': 12,
          'set-cookie': ['a=1', 'b=2'],
          'x-disabled': false,
        },
      };
    },
  });
  const response = await createAxiosTransport(client)(
    new Request('http://localhost/rpc', { method: 'HEAD' }),
    {},
    { context: {} },
    [],
    undefined,
  );
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(response.headers.get('x-number')).toBe('12');
  expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  expect(response.headers.has('x-disabled')).toBe(false);
});

it('supports Yup Standard Schema directly and manual mounting without a Hono dependency', async () => {
  const input = object({ name: string().required() }).required();
  const output = object({ greeting: string().required() }).required();
  const api = {
    greet: defineRpcProcedure(
      async ({ name }: { name: string }) => ({ greeting: `Hi ${name}` }),
      {
        input,
        output,
      },
    ),
  };
  const handler = createRpcHandler(api);
  const queries = createQueries(
    defineRpcEndpoint('/rpc', { greet: { input, output } }),
    {
      origin: 'http://localhost',
      fetch: async (request) => {
        const result = await handler.handle(request, { prefix: '/rpc' });
        return result.matched
          ? result.response
          : new Response(null, { status: 404 });
      },
    },
  );
  const result = await queries.greet.call({ name: 'Example' });
  expectTypeOf(result).toEqualTypeOf<{ greeting: string }>();
  expect(result).toEqual({ greeting: 'Hi Example' });
  await expect(queries.greet.call({ name: '' })).rejects.toThrow();
  const invalid = createQueries(
    defineRpcEndpoint('/rpc', {
      greet: { input, output, responseValidator: output },
    }),
    {
      origin: 'http://localhost',
      fetch: async () => Response.json({ json: { greeting: null } }),
    },
  );
  await expect(invalid.greet.call({ name: 'Example' })).rejects.toThrow(
    'RPC response validation failed',
  );
});

it('uses explicit unchecked contracts and supports native Fetch and Axios over a manually mounted Node API', async () => {
  const api = {
    facts: defineUncheckedRpcProcedure(async () => ({
      title: 'Example',
      count: 5,
    })),
    echo: defineUncheckedRpcProcedure(async (input: { query: string }) => ({
      query: input.query,
    })),
    failure: defineUncheckedRpcProcedure(async () => {
      throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'Unavailable' });
    }),
  };
  const endpoint = defineRpcEndpoint('/rpc', {
    facts: defineUncheckedRpcContract<
      undefined,
      { title: string; count: number }
    >(),
    echo: defineUncheckedRpcContract<{ query: string }, { query: string }>(),
    failure: defineUncheckedRpcContract<undefined, never>(),
  });
  const handler = createNodeRpcHandler(api);
  const server = createServer((request, response) => {
    void handler
      .handle(request, response, { prefix: '/rpc' })
      .then(({ matched }) => {
        if (!matched) {
          response.statusCode = 404;
          response.end();
        }
      })
      .catch(() => {
        response.statusCode = 500;
        response.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected local server port');
  const url = `http://127.0.0.1:${address.port}/rpc`;
  try {
    const nativeQueries = createQueries(endpoint, {
      origin: url,
    });
    const facts = await nativeQueries.facts.call();
    expectTypeOf(facts).toEqualTypeOf<{ title: string; count: number }>();
    expect(facts).toEqual({ title: 'Example', count: 5 });
    expect(
      await createQueries(endpoint, {
        origin: url,
        fetch: kyTransport,
      }).facts.call(),
    ).toEqual(facts);
    const queries = createQueries(endpoint, {
      origin: url,
      fetch: createAxiosTransport(axios.create()),
    });
    expect(await queries.echo.call({ query: 'A & B' })).toEqual({
      query: 'A & B',
    });
    await expect(queries.failure.call()).rejects.toThrow('Unavailable');
    const controller = new AbortController();
    controller.abort();
    await expect(
      queries.facts.call(undefined, { signal: controller.signal }),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
