# orpc-stack

Expose existing TypeScript functions through oRPC and consume typed TanStack Query options. One shared contract supplies the endpoint, types, and validation.

```sh
npm install orpc-stack
```

## Quick start

Zod and Hono illustrate this example; use your preferred validation library and server adapter.

```ts
// shared.ts
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { z } from 'zod';

// Share the endpoint, types, and validation.
export const endpoint = defineRpcEndpoint('/api/rpc', {
  count: { output: z.number() },
});
```

```ts
// server.ts
import { Hono } from 'hono';
import { mountHono } from 'orpc-stack/hono';
import { endpoint } from './shared.js';

const getCount = async () => 42;
const api = { count: getCount }; // Bind names to server functions.
const app = new Hono();
mountHono(app, endpoint, api); // Serve the RPC endpoint.
```

```tsx
// client.tsx
import { useQuery } from '@tanstack/react-query';
import { createQueries } from 'orpc-stack/client';
import { endpoint } from './shared.js';

const queries = createQueries(endpoint); // Create typed query options.

// Inside a component under QueryClientProvider:
const count = useQuery(queries.count.queryOptions());
```

Schemas bind to functions by name. Fetch is the default transport. Set `origin` for external APIs or SSR; browsers use the current origin.

## Validation options

Zod is shown above; any Standard Schema works directly, without a resolver. Omitted input means validated no input. Add an `input` schema for arguments; keep shared contracts free of server imports and secrets.

<details>
<summary>Yup (1.7+) or unchecked TypeScript</summary>

Replace the `count` contract with either option:

```ts
import * as yup from 'yup';
const count = { output: yup.number().required() };
```

```ts
import { defineUncheckedRpcContract } from 'orpc-stack/endpoint';
const count = defineUncheckedRpcContract<undefined, number>();
```

Unchecked mode preserves compile-time types but performs no runtime validation.

</details>

<details>
<summary>Standard Schema without a validation library</summary>

```ts
import type { Schema } from '@orpc/server';

const numberSchema = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value)
        ? { value }
        : { issues: [{ message: 'Expected a finite number' }] },
  },
} satisfies Schema<number, number>;
// count: { output: numberSchema }
```

</details>

Output schemas validate/transform once on the server. Optional `responseValidator` checks parsed client replies without replacing them.

## Pagination

Add `list` to the shared endpoint:

```ts
list: {
  input: z.object({ query: z.string(), cursor: z.number().int().nonnegative() }),
  output: z.object({
    results: z.array(z.string()),
    total: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().nullable(),
  }),
}
```

Then wrap an array-returning server function and use an infinite query:

```ts
import { paginate } from 'orpc-stack/server';

const listItems = async ({ query }: { query: string }) =>
  ['Apple', 'Apricot', 'Banana'].filter(item => item.includes(query));
mountHono(app, endpoint, {
  count: getCount,
  list: paginate(listItems, { pageSize: 2 }), // Turn arrays into pages.
});
```

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';

const items = useInfiniteQuery(queries.list.infiniteOptions({
  input: (cursor: number) => ({ query: 'Ap', cursor }),
  initialPageParam: 0,
  getNextPageParam: page => page.nextCursor ?? undefined,
}));
// items.data?.pages.flatMap(page => page.results)
// items.fetchNextPage() loads more when items.hasNextPage is true.
```

Replace the quick-start mount with this one. Pages default to 20 items. `paginateArray(items, { cursor, pageSize })` is also available from `/server`. A null array produces null results with zero total; allow nullable results in your contract if needed.

Array pagination loads the full collection per request and assumes stable ordering. Use it for small collections; paginate large database lists in the query itself.

## Other server adapters

These examples reuse the quick-start `endpoint` and plain-function `api`. Register authentication before RPC routes; Nest controller guards do not cover directly mounted RPC routes.

<details>
<summary>Fastify</summary>

```ts
import Fastify from 'fastify';
import { mountFastify } from 'orpc-stack/fastify';

const app = Fastify();
mountFastify(app, endpoint, api);
await app.listen({ port: 3000 });
```

RPC body parsers are scoped; existing REST parsers stay intact.

</details>

<details>
<summary>NestJS with Fastify</summary>

```ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mountFastify } from 'orpc-stack/fastify';
import { AppModule } from './app.js';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule, new FastifyAdapter(),
);
mountFastify(app.getHttpAdapter().getInstance(), endpoint, api);
await app.listen(3000);
```

For injected services, use `app.get(YourService)` and wrap its methods in arrow functions. Apply authentication with Fastify hooks before mounting.

</details>

<details>
<summary>NestJS with Express</summary>

```ts
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import { defineRpcApi } from 'orpc-stack/server';
import { createNodeRpcHandler } from 'orpc-stack/node';
import { AppModule } from './app.js';

const app = await NestFactory.create(AppModule, { bodyParser: false });
const rpc = createNodeRpcHandler(defineRpcApi(endpoint, api));
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await rpc.handle(req, res, { prefix: endpoint.path });
    if (!result.matched) next();
  } catch (error) {
    next(error);
  }
});
await app.listen(3000);
```

RPC needs the unread body. Register REST JSON parsers after RPC middleware and authentication before it.

</details>

<details>
<summary>Any Fetch server</summary>

```ts
import { defineRpcApi } from 'orpc-stack/server';
import { createRpcHandler } from 'orpc-stack/handler';

const rpc = createRpcHandler(defineRpcApi(endpoint, api));
const handle = async (request: Request) => {
  const result = await rpc.handle(request, { prefix: endpoint.path });
  return result.matched ? result.response : new Response('Not found', { status: 404 });
};
```

</details>

## Error mapping

Pass `mapHandlerError` to the mounter to map plain-function failures. Validation and protocol errors keep oRPC's own handling.

<details>
<summary>Map handler failures to typed oRPC errors</summary>

```ts
import { ORPCError } from '@orpc/server';

mountHono(app, endpoint, api, {
  mapHandlerError: (error) => {
    if (error instanceof ORPCError) return error;
    console.error('RPC handler failed', error);
    return new ORPCError('SERVICE_UNAVAILABLE', {
      message: 'Try again shortly.',
    });
  },
});
```

The same options work with `mountFastify` or `defineRpcApi`. Existing oRPC errors keep their codes; unexpected failures get a safe public message. Validation and protocol failures use oRPC's own handling.

</details>

Explicit `defineRpcProcedure` and `definePaginatedRpcProcedure` remain available for standalone procedures or per-procedure options; supply their endpoint contract directly.

## Optional transports

Fetch needs no adapter. Use Ky for an existing Ky policy or Axios to reuse instance defaults/interceptors; neither adds RPC type safety. Install your chosen library separately.

**Ky**

```ts
import { kyTransport } from 'orpc-stack/ky';
const queries = createQueries(endpoint, { fetch: kyTransport });
```

<details>
<summary>Use your configured Ky instance</summary>

```ts
import { kyInstance } from './http.js'; // Your ky.create(...) or ky.extend(...) instance.

const queries = createQueries(endpoint, {
  fetch: (request, init) => kyInstance(request, {
    ...init,
    throwHttpErrors: false,
    retry: 0,
  }),
});
```

Your instance's headers and hooks still apply. Disable Ky retries to avoid stacking them with query retries, and let oRPC decode non-success responses. Hooks should preserve the response body and leave RPC error responses to oRPC.

</details>

**Axios**

```ts
import axios from 'axios';
import { createAxiosTransport } from 'orpc-stack/axios';

const queries = createQueries(endpoint, {
  fetch: createAxiosTransport(axios.create()),
});
```

<details>
<summary>Use your configured Axios instance</summary>

```ts
import { axiosInstance } from './http.js'; // Your axios.create(...) instance with interceptors.

const queries = createQueries(endpoint, {
  fetch: createAxiosTransport(axiosInstance),
});
```

Instance defaults and request/response interceptors still apply. Keep response interceptors compatible with raw `AxiosResponse<ArrayBuffer>`; do not unwrap `response.data`, parse it as JSON, or throw for RPC error statuses. The adapter supplies the URL, body, signal, response type, and status policy.

</details>

## Export reference

| Import from | Export | Purpose |
| --- | --- | --- |
| `orpc-stack/endpoint` | `defineRpcEndpoint` | Shared RPC contract |
| `orpc-stack/endpoint` | `defineUncheckedRpcContract` | Types without validation |
| `orpc-stack/client` | `createQueries` | Typed query options |
| `orpc-stack/server` | `defineRpcApi` | Bind endpoint functions |
| `orpc-stack/server` | `paginate` | Paginated function wrapper |
| `orpc-stack/server` | `paginateArray` | Slice array pages |
| `orpc-stack/server` | `defineRpcProcedure` | Explicit checked procedure |
| `orpc-stack/server` | `defineUncheckedRpcProcedure` | Explicit unchecked procedure |
| `orpc-stack/server` | `definePaginatedRpcProcedure` | Explicit paginated procedure |
| `orpc-stack/hono` | `mountHono` | Mount Hono routes |
| `orpc-stack/fastify` | `mountFastify` | Mount Fastify routes |
| `orpc-stack/handler` | `createRpcHandler` | Fetch request handler |
| `orpc-stack/node` | `createNodeRpcHandler` | Node request handler |
| `orpc-stack/ky` | `kyTransport` | Default Ky adapter |
| `orpc-stack/axios` | `createAxiosTransport` | Axios instance adapter |

The root `orpc-stack` also exports the endpoint/client helpers and these types:
`RpcEndpoint`, `RpcApi`, `RpcClient`, `RpcFetch`, `QueryConnectionOptions`.

Useful companion exports (from their own packages):

| Import from | Export | Purpose |
| --- | --- | --- |
| `@orpc/server` | `ORPCError` | Coded RPC errors |
| `@orpc/server` | `Schema` (type) | Standard Schema contract |
| `@tanstack/react-query` | `useQuery` | Cached query hook |
| `@tanstack/react-query` | `useInfiniteQuery` | Paginated query hook |
| `@tanstack/react-query` | `QueryClientProvider` | Query client context |

ESM; Node.js 22+ or modern browsers. Built on oRPC and TanStack Query. [MIT](LICENSE).
