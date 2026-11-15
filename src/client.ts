import { createORPCClient } from '@orpc/client';
import type { RPCLinkOptions } from '@orpc/client/fetch';
import { RPCLink } from '@orpc/client/fetch';
import type { InferSchemaInput, InferSchemaOutput } from '@orpc/server';
import type { ProcedureUtils } from '@orpc/tanstack-query';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import {
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { resolvePagination } from './infinite-pagination.js';
import type {
  NoInputSchema,
  PaginationInputKey,
  QueryConnectionOptions,
  RpcClient,
  RpcContract,
  RpcEndpoint,
  RpcProcedureContracts,
} from './types.js';

type Input<C extends RpcContract> = InferSchemaInput<C['input']>;
type Output<C extends RpcContract> = InferSchemaOutput<C['output']>;
type QueryOptions<O, E, S> = Omit<
  UseQueryOptions<O, E, S>,
  'queryKey' | 'queryFn'
>;
type InfiniteOptions<O, E, S, Cursor = number> = Omit<
  UseInfiniteQueryOptions<O, E, S, readonly unknown[], Cursor>,
  'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
> & {
  initialPageParam?: Cursor;
  getNextPageParam?: UseInfiniteQueryOptions<
    O,
    E,
    S,
    readonly unknown[],
    Cursor
  >['getNextPageParam'];
};
type InputArgs<I, Options> = undefined extends I
  ? [input?: I, options?: Options, queryClient?: QueryClient]
  : [input: I, options?: Options, queryClient?: QueryClient];
type Cursor<C extends RpcContract> = Input<C>[PaginationInputKey<C> &
  keyof Input<C>];

type PageInput<C extends RpcContract> = Omit<Input<C>, PaginationInputKey<C>>;
type InfiniteInput<C extends RpcContract> =
  Record<never, never> extends PageInput<C>
    ? PageInput<C> | undefined
    : PageInput<C>;

type Hook<C extends RpcContract, E extends Error> = C extends {
  kind: 'mutation';
}
  ? <Context = unknown>(
      options?: Omit<
        UseMutationOptions<Output<C>, E, Input<C>, Context>,
        'mutationKey' | 'mutationFn'
      >,
      queryClient?: QueryClient,
    ) => UseMutationResult<Output<C>, E, Input<C>, Context>
  : QueryHook<C, E>;

type NoInputQueryHook<C extends RpcContract, E extends Error> = {
  <Selected = Output<C>>(
    options?: QueryOptions<Output<C>, E, Selected>,
    queryClient?: QueryClient,
  ): UseQueryResult<Selected, E>;
  <Selected = Output<C>>(
    input: undefined,
    options?: QueryOptions<Output<C>, E, Selected>,
    queryClient?: QueryClient,
  ): UseQueryResult<Selected, E>;
};

type QueryHook<C extends RpcContract, E extends Error> = C extends {
  kind: 'infinite';
}
  ? <Selected = InfiniteData<Output<C>, Cursor<C>>>(
      ...args: InputArgs<
        InfiniteInput<C>,
        InfiniteOptions<Output<C>, E, Selected, Cursor<C>>
      >
    ) => UseInfiniteQueryResult<Selected, E>
  : C['input'] extends NoInputSchema
    ? NoInputQueryHook<C, E>
    : <Selected = Output<C>>(
        ...args: InputArgs<Input<C>, QueryOptions<Output<C>, E, Selected>>
      ) => UseQueryResult<Selected, E>;

type HookName<K extends string, C extends RpcContract> = C extends {
  kind: 'mutation';
}
  ? `use${Capitalize<K>}Mutation`
  : C extends { kind: 'infinite' }
    ? `use${Capitalize<K>}InfiniteQuery`
    : `use${Capitalize<K>}Query`;

export type RpcReactHooks<
  C extends RpcProcedureContracts,
  E extends Error = Error,
> = {
  [K in keyof C & string as HookName<K, C[K]>]: Hook<C[K], E>;
};

export const createQueries = <
  TContracts extends RpcProcedureContracts,
  TError extends Error = Error,
>(
  endpoint: RpcEndpoint<TContracts>,
  options: QueryConnectionOptions = {},
) => {
  const configuredOrigin = options.origin
    ? new URL(options.origin).origin
    : undefined;
  const linkOptions: RPCLinkOptions<Record<never, never>> = {
    url: () => {
      const origin = configuredOrigin ?? globalThis.location?.origin;
      if (!origin)
        throw new Error('Provide origin when calling RPC outside a browser.');
      return new URL(endpoint.path, origin);
    },
    interceptors: [
      async ({ path, next }) => {
        const result = await next();
        const schema = endpoint.procedures[path.join('.')]?.responseValidator;
        if (!schema) return result;
        const validated = await schema['~standard'].validate(result);
        if (validated.issues)
          throw new Error('RPC response validation failed.');
        return result;
      },
    ],
  };
  if (options.fetch) linkOptions.fetch = options.fetch;
  const client: RpcClient<TContracts, TError> = createORPCClient(
    new RPCLink(linkOptions),
  );
  const rpc = createTanstackQueryUtils(client, {
    path: [
      ...(options.keyPrefix ?? [
        'orpc-stack',
        configuredOrigin ?? 'same-origin',
        endpoint.path,
      ]),
    ],
  });
  const hooks: Record<string, unknown> = Object.create(null);
  for (const [name, contract] of Object.entries(endpoint.procedures)) {
    // The mapped public type preserves each procedure's input/output. Runtime
    // dispatch only needs the common options builders, never schema internals.
    const procedure = (rpc as unknown as Record<string, unknown>)[
      name
    ] as ProcedureUtils<Record<never, never>, unknown, unknown, TError>;
    const prefix = `use${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    let hookName: string;
    let hook: unknown;
    if (contract.kind === 'mutation') {
      hookName = `${prefix}Mutation`;
      hook = (
        options: UseMutationOptions<unknown, TError, unknown> = {},
        queryClient?: QueryClient,
      ) => useMutation(procedure.mutationOptions(options), queryClient);
    } else if (contract.kind === 'infinite') {
      const pagination = resolvePagination(contract.pagination);
      hookName = `${prefix}InfiniteQuery`;
      hook = (
        input: Record<string, unknown> = {},
        options: InfiniteOptions<
          unknown,
          TError,
          InfiniteData<unknown, unknown>,
          unknown
        > = {},
        queryClient?: QueryClient,
      ) =>
        useInfiniteQuery(
          procedure.infiniteOptions({
            ...options,
            input: (cursor: unknown) => ({
              ...input,
              [pagination.input]: cursor,
            }),
            initialPageParam:
              options.initialPageParam === undefined
                ? pagination.initial
                : options.initialPageParam,
            getNextPageParam:
              options.getNextPageParam ??
              ((page) =>
                (page as Record<string, unknown>)[pagination.next] ??
                undefined),
          }),
          queryClient,
        );
    } else {
      hookName = `${prefix}Query`;
      if (contract.input['~standard'].vendor === 'orpc-stack/no-input') {
        hook = (
          inputOrOptions?: QueryOptions<unknown, TError, unknown>,
          optionsOrClient?:
            | QueryOptions<unknown, TError, unknown>
            | QueryClient,
          queryClient?: QueryClient,
        ) => {
          const legacy =
            queryClient !== undefined ||
            (inputOrOptions === undefined &&
              optionsOrClient !== undefined &&
              !('getQueryCache' in optionsOrClient));
          const options = legacy ? optionsOrClient : (inputOrOptions ?? {});
          const client = legacy
            ? queryClient
            : (optionsOrClient as QueryClient | undefined);
          return useQuery(
            procedure.queryOptions({ ...options, input: undefined }),
            client,
          );
        };
      } else
        hook = (
          input?: unknown,
          options: QueryOptions<unknown, TError, unknown> = {},
          queryClient?: QueryClient,
        ) =>
          useQuery(procedure.queryOptions({ ...options, input }), queryClient);
    }
    if (
      Object.hasOwn(hooks, hookName) ||
      Object.hasOwn(endpoint.procedures, hookName)
    ) {
      throw new Error(`Duplicate generated hook name: ${hookName}`);
    }
    hooks[hookName] = hook;
  }
  return new Proxy(rpc, {
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.hasOwn(hooks, property)) {
        return hooks[property];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as typeof rpc & RpcReactHooks<TContracts, TError>;
};
