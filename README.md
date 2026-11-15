# orpc-stack

Expose TypeScript functions through oRPC with a shared contract, validation, and typed TanStack Query hooks.

```sh
npm install orpc-stack react @tanstack/react-query
```

ESM; Node.js 22+ or modern browsers. Examples use Zod and Hono; other Standard Schema libraries and server adapters work too.

## Quick start

```ts
// shared.ts
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { z } from 'zod';

export const endpoint = defineRpcEndpoint('/api/rpc', {
  count: { output: z.number() },
  increment: {
    kind: 'mutation',
    input: z.object({ amount: z.number() }),
    output: z.number(),
  },
});
```

```ts
// server.ts
import { Hono } from 'hono';
import { mountHono } from 'orpc-stack/hono';
import { endpoint } from './shared.js';

let count = 0;
const app = new Hono();
mountHono(app, endpoint, {
  count: () => count,
  increment: ({ amount }) => (count += amount),
});
```

```tsx
// client.tsx
import { useQueryClient } from '@tanstack/react-query';
import { createQueries } from 'orpc-stack/client';
import { endpoint } from './shared.js';

export const queries = createQueries(endpoint);
export const { useCountQuery, useIncrementMutation } = queries;

// Inside a component under QueryClientProvider:
const queryClient = useQueryClient();
const count = useCountQuery();
const increment = useIncrementMutation({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queries.count.key() }),
});
// In an event handler:
increment.mutate({ amount: 1 });
```

Create `queries` once at module scope. Fetch uses the current browser origin; pass `{ origin: 'https://api.example.com' }` for external APIs or SSR.

## Hooks and manual options

| Contract `kind` | Generated hook | Arguments |
| --- | --- | --- |
| `'query'` (default) | `useNameQuery` | `(input?, options?)` |
| `'mutation'` | `useNameMutation` | `(options?)` |
| `'infinite'` | `useNameInfiniteQuery` | `(input?, options?)` |

Inputs and results are inferred; required inputs stay required. Hooks accept TanStack options and return TanStack results. Cache invalidation is explicit.

When the contract omits `input`, use `useCountQuery(options)` or `useCountQuery(undefined, options)`.

The same object exposes manual calls and options with matching cache keys:

```tsx
import { useQuery } from '@tanstack/react-query';

await queries.increment.call({ amount: 1 });
const count = useQuery(queries.count.queryOptions({ staleTime: 60_000 }));
// Also available: mutationOptions(), infiniteOptions(), and key helpers.
```

## TanStack Start

Follow [oRPC's Start guide](https://orpc.dev/docs/adapters/tanstack-start), then wrap its isomorphic client:

```ts
const rpc = createQueries(endpoint, { client });
// Route loader; components share the same query cache:
loader: ({ context }) => rpc.load(context.queryClient, { count: {} })
```

## Pagination

Add `list` to the shared endpoint. `kind: 'infinite'` generates and validates `cursor` and `nextCursor` automatically:

```ts
list: {
  kind: 'infinite',
  input: z.object({ query: z.string() }),
  output: z.object({
    results: z.array(z.string()),
    total: z.number().int().nonnegative(),
  }),
}
```

Wrap an array-returning server function:

```ts
import { paginate } from 'orpc-stack/server';

const listItems = async ({ query }: { query: string }) =>
  ['Apple', 'Apricot', 'Banana'].filter(item => item.includes(query));
mountHono(app, endpoint, {
  count: () => count,
  increment: ({ amount }) => (count += amount),
  list: paginate(listItems, { pageSize: 2 }),
});
```

```tsx
// At module scope:
export const { useListInfiniteQuery } = createQueries(endpoint);

// Inside a component under QueryClientProvider:
const items = useListInfiniteQuery({ query: 'Ap' });
// items.data?.pages.flatMap(page => page.results)
// items.fetchNextPage() loads more when items.hasNextPage is true.
```

Generated cursors are integers starting at `0`; `nextCursor: null` ends pagination. Explicit schemas control their own fields. Custom names and starting values go in `pagination`; hook options or manual `infiniteOptions()` support other paging logic. Strict object schemas must declare the pagination fields.

`paginate` defaults to 20 items per page. `paginateArray(items, { cursor, pageSize })` is also available from `/server`. These helpers load the full array per request; use them for small collections and paginate large database lists in the query itself.

## Validation

Contracts accept any Standard Schema, including Zod and Yup. Omitted input means no arguments. Output validation and transforms run on the server; optional `responseValidator` checks parsed client replies.

For trusted data without runtime validation:

```ts
import { defineUncheckedRpcContract } from 'orpc-stack/endpoint';
const count = defineUncheckedRpcContract<undefined, number>();
```

## Server adapters

| Import from | Export | Usage |
| --- | --- | --- |
| `orpc-stack/hono` | `mountHono` | `mountHono(app, endpoint, api)` |
| `orpc-stack/fastify` | `mountFastify` | `mountFastify(app, endpoint, api)` |
| `orpc-stack/handler` | `createRpcHandler` | Fetch handler for `defineRpcApi(endpoint, api)` |
| `orpc-stack/node` | `createNodeRpcHandler` | Node handler for `defineRpcApi(endpoint, api)` |

`defineRpcApi` comes from `orpc-stack/server`. Handler `.handle()` calls take `{ prefix: endpoint.path }` and return a `matched` flag. Fetch handlers also return a `response`.

For NestJS with Fastify, pass `app.getHttpAdapter().getInstance()` to `mountFastify`. Wrap injected service methods in arrow functions. With Express, mount the Node handler before body parsers so it receives the unread body.

Register authentication before RPC routes. Nest controller guards do not cover directly mounted routes.

### Next.js App Router

For an endpoint at `/api/rpc`, create `app/api/rpc/[...path]/route.ts`:

```ts
import { createNextHandler } from 'orpc-stack/next';
import { endpoint } from '@/lib/contract';
import { api } from '@/lib/api';

export const POST = createNextHandler(endpoint, api);
```

The handler uses the contract path, returns 404 for unknown procedures, and accepts the same optional `mapHandlerError` options as the mounters.

## Error mapping

Mounters and `defineRpcApi` accept `mapHandlerError` for plain-function failures:

```ts
import { ORPCError } from '@orpc/server';

mountHono(app, endpoint, api, {
  mapHandlerError: error => error instanceof ORPCError
    ? error
    : new ORPCError('SERVICE_UNAVAILABLE', { message: 'Try again shortly.' }),
});
```

Validation and protocol errors retain oRPC handling. For standalone procedures or per-procedure options, use `defineRpcProcedure`, `defineUncheckedRpcProcedure`, or `definePaginatedRpcProcedure` from `orpc-stack/server`.

## Custom transports

Fetch works by default. To reuse an Axios instance or Ky configuration:

```ts
import { createAxiosTransport } from 'orpc-stack/axios';
const queries = createQueries(endpoint, { fetch: createAxiosTransport(axiosInstance) });
```

```ts
import { kyTransport } from 'orpc-stack/ky';
const queries = createQueries(endpoint, { fetch: kyTransport });
```

For a configured Ky instance, pass a fetch wrapper with `throwHttpErrors: false` and `retry: 0`. Preserve raw response bodies and let oRPC handle error statuses. Axios response interceptors must preserve `AxiosResponse<ArrayBuffer>`.

The root `orpc-stack` exports the endpoint/client helpers and types: `RpcEndpoint`, `RpcApi`, `RpcClient`, `RpcFetch`, `QueryConnectionOptions`, and `InfinitePagination`.

[MIT](LICENSE).
