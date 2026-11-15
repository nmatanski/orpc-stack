import { type ClientLink, createORPCClient } from '@orpc/client';
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
  type UseSuspenseInfiniteQueryResult,
  type UseSuspenseQueryOptions,
  type UseSuspenseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { resolvePagination } from './infinite-pagination.js';
import type {
  IsPaginated,
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

type InfiniteHook<C extends RpcContract, E extends Error> = <
  Selected = InfiniteData<Output<C>, Cursor<C>>,
>(
  ...args: InputArgs<
    InfiniteInput<C>,
    InfiniteOptions<Output<C>, E, Selected, Cursor<C>>
  >
) => UseInfiniteQueryResult<Selected, E>;

type QueryHook<
  C extends RpcContract,
  E extends Error,
> = C['input'] extends NoInputSchema
  ? NoInputQueryHook<C, E>
  : <Selected = Output<C>>(
      ...args: InputArgs<Input<C>, QueryOptions<Output<C>, E, Selected>>
    ) => UseQueryResult<Selected, E>;

type SuspenseOptions<C extends RpcContract, E, S> = Omit<
  UseSuspenseQueryOptions<Output<C>, E, S>,
  'queryKey' | 'queryFn'
>;
type SuspenseHook<
  C extends RpcContract,
  E extends Error,
> = C['input'] extends NoInputSchema
  ? {
      <S = Output<C>>(
        options?: SuspenseOptions<C, E, S>,
        queryClient?: QueryClient,
      ): UseSuspenseQueryResult<S, E>;
      <S = Output<C>>(
        input: undefined,
        options?: SuspenseOptions<C, E, S>,
        queryClient?: QueryClient,
      ): UseSuspenseQueryResult<S, E>;
    }
  : <S = Output<C>>(
      ...args: InputArgs<Input<C>, SuspenseOptions<C, E, S>>
    ) => UseSuspenseQueryResult<S, E>;
type SuspenseInfiniteHook<C extends RpcContract, E extends Error> = <
  S = InfiniteData<Output<C>, Cursor<C>>,
>(
  ...args: InputArgs<
    InfiniteInput<C>,
    Omit<
      InfiniteOptions<Output<C>, E, S, Cursor<C>>,
      'enabled' | 'placeholderData' | 'throwOnError'
    >
  >
) => UseSuspenseInfiniteQueryResult<S, E>;

type HookName<K extends string, C extends RpcContract> = C extends {
  kind: 'mutation';
}
  ? `use${Capitalize<K>}Mutation`
  : C extends { kind: 'infinite' }
    ? never
    : `use${Capitalize<K>}Query`;

export type RpcReactHooks<
  C extends RpcProcedureContracts,
  E extends Error = Error,
> = {
  [K in keyof C & string as HookName<K, C[K]>]: Hook<C[K], E>;
} & {
  [K in keyof C & string as IsPaginated<C[K]> extends true
    ? `use${Capitalize<K>}InfiniteQuery`
    : never]: InfiniteHook<C[K], E>;
} & {
  [K in keyof C & string as C[K] extends { kind: 'mutation' | 'infinite' }
    ? never
    : `use${Capitalize<K>}SuspenseQuery`]: SuspenseHook<C[K], E>;
} & {
  [K in keyof C & string as IsPaginated<C[K]> extends true
    ? `use${Capitalize<K>}SuspenseInfiniteQuery`
    : never]: SuspenseInfiniteHook<C[K], E>;
};

type LoadEntry<C extends RpcContract, E extends Error> = C extends {
  kind: 'infinite';
}
  ? Omit<
      InfiniteOptions<
        Output<C>,
        E,
        InfiniteData<Output<C>, Cursor<C>>,
        Cursor<C>
      >,
      'select'
    > & { pages?: number } & (Record<never, never> extends PageInput<C>
        ? { input?: PageInput<C> }
        : { input: PageInput<C> })
  : Omit<QueryOptions<Output<C>, E, Output<C>>, 'select'> &
      (undefined extends Input<C> ? { input?: Input<C> } : { input: Input<C> });
type LoadSelection<C extends RpcProcedureContracts, E extends Error> = {
  [K in keyof C as C[K] extends { kind: 'mutation' } ? never : K]?: LoadEntry<
    C[K],
    E
  >;
};
type LoadResult<C extends RpcProcedureContracts, Selection> = {
  [K in keyof Selection]: K extends keyof C
    ? C[K] extends { kind: 'infinite' }
      ? InfiniteData<Output<C[K]>, Cursor<C[K]>>
      : Output<C[K]>
    : never;
};
export type RpcLoader<
  C extends RpcProcedureContracts,
  E extends Error = Error,
> = {
  load<S extends LoadSelection<C, E>>(
    queryClient: QueryClient,
    selection: S & Record<Exclude<keyof S, keyof LoadSelection<C, E>>, never>,
  ): Promise<LoadResult<C, S>>;
};
/** Build the default HTTP client independently of query utilities. */
export const createRpcClient = <
  C extends RpcProcedureContracts,
  E extends Error = Error,
>(
  endpoint: RpcEndpoint<C>,
  options: QueryConnectionOptions = {},
): RpcClient<C, E> => {
  const linkOptions: RPCLinkOptions<Record<never, never>> = {
    ...options.linkOptions,
    url: async () => {
      const configured =
        typeof options.origin === 'function'
          ? await options.origin()
          : options.origin;
      const origin = configured
        ? new URL(configured).origin
        : globalThis.location?.origin;
      if (!origin)
        throw new Error('Provide origin when calling RPC outside a browser.');
      return new URL(endpoint.path, origin);
    },
    interceptors: [
      ...(options.linkOptions?.interceptors ?? []),
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
  if (options.headers) linkOptions.headers = options.headers;
  return createORPCClient(new RPCLink(linkOptions));
};

export type CreateQueriesOptions<
  C extends RpcProcedureContracts,
  E extends Error = Error,
> = QueryConnectionOptions &
  (
    | { client: RpcClient<C, E>; link?: never }
    | { link: ClientLink<Record<never, never>>; client?: never }
    | { client?: never; link?: never }
  );

export const createQueries = <
  TContracts extends RpcProcedureContracts,
  TError extends Error = Error,
>(
  endpoint: RpcEndpoint<TContracts>,
  options: CreateQueriesOptions<TContracts, TError> = {},
) => {
  const client =
    options.client ??
    (options.link
      ? createORPCClient<RpcClient<TContracts, TError>>(options.link)
      : createRpcClient<TContracts, TError>(endpoint, options));
  const rpc = createTanstackQueryUtils(client, {
    path: [...(options.keyPrefix ?? ['orpc-stack', endpoint.path])],
  });
  const load = async (
    queryClient: QueryClient,
    selection: Record<string, Record<string, unknown>>,
  ) => {
    const entries = await Promise.all(
      Object.entries(selection).map(async ([name, options]) => {
        const contract = endpoint.procedures[name];
        if (!contract || contract.kind === 'mutation')
          throw new Error(`Not a loadable query: ${name}`);
        const procedure = (
          rpc as unknown as Record<
            string,
            ProcedureUtils<Record<never, never>, unknown, unknown, Error>
          >
        )[name];
        if (!procedure) throw new Error(`Missing query: ${name}`);
        if (contract.kind !== 'infinite')
          return [
            name,
            await queryClient.query(
              procedure.queryOptions(
                options as QueryOptions<unknown, Error, unknown> & {
                  input?: unknown;
                },
              ),
            ),
          ];
        const pagination = resolvePagination(contract.pagination);
        const typed = options as InfiniteOptions<
          unknown,
          Error,
          InfiniteData<unknown, unknown>,
          unknown
        > & { input?: Record<string, unknown> };
        const { input, ...overrides } = typed;
        const infinite = procedure.infiniteOptions({
          ...overrides,
          initialPageParam:
            overrides.initialPageParam === undefined
              ? pagination.initial
              : overrides.initialPageParam,
          getNextPageParam:
            overrides.getNextPageParam ??
            ((page: unknown) =>
              (page as Record<string, unknown>)[pagination.next] ?? undefined),
          input: (cursor: unknown) => ({
            ...input,
            [pagination.input]: cursor,
          }),
        });
        return [name, await queryClient.infiniteQuery(infinite)];
      }),
    );
    return Object.fromEntries(entries);
  };
  const loader = new Proxy(load, {
    get(target, property, receiver) {
      if (Object.hasOwn(endpoint.procedures, 'load'))
        return Reflect.get(
          (rpc as unknown as Record<string, object>).load ?? target,
          property,
        );
      return Reflect.get(target, property, receiver);
    },
  });
  const hooks: Record<string, unknown> = Object.create(null);
  for (const [name, contract] of Object.entries(endpoint.procedures)) {
    // The mapped public type preserves each procedure's input/output. Runtime
    // dispatch only needs the common options builders, never schema internals.
    const procedure = (rpc as unknown as Record<string, unknown>)[
      name
    ] as ProcedureUtils<Record<never, never>, unknown, unknown, TError>;
    let kinds = ['query', 'suspense'];
    if (contract.kind === 'mutation') kinds = ['mutation'];
    else if (contract.kind === 'infinite')
      kinds = ['infinite', 'suspense-infinite'];
    else if (contract.pagination) kinds.push('infinite', 'suspense-infinite');
    for (const kind of kinds) {
      const prefix = `use${name.charAt(0).toUpperCase()}${name.slice(1)}`;
      let hookName: string;
      let hook: unknown;
      if (kind === 'mutation') {
        hookName = `${prefix}Mutation`;
        hook = (
          options: UseMutationOptions<unknown, TError, unknown> = {},
          queryClient?: QueryClient,
        ) => useMutation(procedure.mutationOptions(options), queryClient);
      } else if (kind === 'infinite' || kind === 'suspense-infinite') {
        const pagination = resolvePagination(contract.pagination);
        hookName =
          kind === 'suspense-infinite'
            ? `${prefix}SuspenseInfiniteQuery`
            : `${prefix}InfiniteQuery`;
        const useInfinite =
          kind === 'suspense-infinite'
            ? useSuspenseInfiniteQuery
            : useInfiniteQuery;
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
          useInfinite(
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
        hookName =
          kind === 'suspense' ? `${prefix}SuspenseQuery` : `${prefix}Query`;
        const useRegularQuery =
          kind === 'suspense' ? useSuspenseQuery : useQuery;
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
            return useRegularQuery(
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
            useRegularQuery(
              procedure.queryOptions({ ...options, input }),
              queryClient,
            );
      }
      if (
        Object.hasOwn(hooks, hookName) ||
        Object.hasOwn(endpoint.procedures, hookName)
      ) {
        throw new Error(`Duplicate generated hook name: ${hookName}`);
      }
      hooks[hookName] = hook;
    }
  }
  return new Proxy(rpc, {
    get(target, property, receiver) {
      if (property === 'load') return loader;
      if (typeof property === 'string' && Object.hasOwn(hooks, property)) {
        return hooks[property];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as typeof rpc &
    RpcReactHooks<TContracts, TError> &
    RpcLoader<TContracts, TError>;
};
