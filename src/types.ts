import type { Client } from '@orpc/client';
import type { RPCLinkOptions } from '@orpc/client/fetch';
import type {
  AnyProcedure,
  Context,
  InferSchemaInput,
  InferSchemaOutput,
  Schema,
} from '@orpc/server';
export type RpcApi = Readonly<Record<string, AnyProcedure>>;
export type RpcFetch = NonNullable<
  RPCLinkOptions<Record<never, never>>['fetch']
>;
export type NoInputSchema = Schema<undefined, undefined> & {
  readonly '~orpc-stack': 'no-input';
};
export type CheckedContract<
  TOutput extends Schema<unknown, unknown> = Schema<unknown, unknown>,
> = {
  input: Schema<unknown, unknown>;
  output: TOutput;
  validation: 'checked';
  kind?: RpcHookKind;
  pagination?: InfinitePagination;
  responseValidator?: Schema<
    InferSchemaOutput<TOutput>,
    InferSchemaOutput<TOutput>
  >;
};
export type UncheckedSchema<T> = Schema<T, T> & {
  readonly '~orpc-stack': 'unchecked';
};
export type RpcHookKind = 'query' | 'mutation' | 'infinite';
export type InfinitePagination = {
  input?: string;
  next?: string;
  initial?: number;
};
type SchemaFields<S> = S extends { fields: infer Fields }
  ? keyof Fields
  : S extends { shape: infer Fields }
    ? keyof Fields
    : never;
type InferredPagination<C> = C extends { input: infer I; output: infer O }
  ? 'cursor' extends SchemaFields<I>
    ? 'nextCursor' extends SchemaFields<O>
      ? { input: 'cursor'; next: 'nextCursor'; initial: 0 }
      : PagePagination<I, O>
    : PagePagination<I, O>
  : never;
type PagePagination<I, O> =
  'page' extends SchemaFields<I>
    ? 'nextPage' extends SchemaFields<O>
      ? { input: 'page'; next: 'nextPage'; initial: 1 }
      : never
    : never;
export type IsPaginated<C> = C extends { kind: 'mutation' }
  ? false
  : C extends { kind: 'infinite' }
    ? true
    : C extends { pagination: InfinitePagination }
      ? true
      : [InferredPagination<C>] extends [never]
        ? false
        : true;
type InferredInputKey<C> = [InferredPagination<C>] extends [never]
  ? 'cursor'
  : InferredPagination<C>['input'];
type InferredNextKey<C> = [InferredPagination<C>] extends [never]
  ? 'nextCursor'
  : InferredPagination<C>['next'];
type ResolvedPagination<C> = {
  input: PaginationInputKey<C>;
  next: PaginationNextKey<C>;
  initial: C extends { pagination: { initial: infer N extends number } }
    ? N
    : [InferredPagination<C>] extends [never]
      ? 0
      : InferredPagination<C>['initial'];
};

type HookMetadata = { kind?: RpcHookKind; pagination?: InfinitePagination };
export type PaginationInputKey<C> = C extends {
  pagination: { input: infer K extends string };
}
  ? K
  : InferredInputKey<C>;
export type PaginationNextKey<C> = C extends {
  pagination: { next: infer K extends string };
}
  ? K
  : InferredNextKey<C>;

type WithField<T, K extends string, V> =
  T extends Record<string, never>
    ? Record<K, V>
    : K extends keyof T
      ? T
      : { [P in keyof T | K]: P extends keyof T ? T[P] : V };
type InputSchema<D extends RpcContractDefinition> = D extends {
  input: infer S extends Schema<unknown, unknown>;
}
  ? S
  : NoInputSchema;
type InfiniteInputValue<T> = [T] extends [undefined] ? Record<never, never> : T;
type NormalizedInput<D extends RpcContractDefinition> =
  IsPaginated<D> extends true
    ? Schema<
        WithField<
          InfiniteInputValue<InferSchemaInput<InputSchema<D>>>,
          PaginationInputKey<D>,
          number
        >,
        WithField<
          InfiniteInputValue<InferSchemaOutput<InputSchema<D>>>,
          PaginationInputKey<D>,
          number
        >
      >
    : InputSchema<D>;
type NormalizedOutput<D extends RpcContractDefinition> =
  IsPaginated<D> extends true
    ? Schema<
        WithField<
          InferSchemaInput<D['output']>,
          PaginationNextKey<D>,
          number | null
        >,
        WithField<
          InferSchemaOutput<D['output']>,
          PaginationNextKey<D>,
          number | null
        >
      >
    : D['output'];
type ObjectConstraint<T> = T extends object ? unknown : never;

export type RpcContract = CheckedContract | UncheckedContract<unknown, unknown>;
export type HandlerErrorOptions = {
  mapHandlerError?: (error: unknown) => Error;
};
export type CheckedProcedureOptions<
  TInput extends Schema<unknown, unknown>,
  TOutput extends Schema<unknown, unknown>,
> = {
  input: TInput;
  output: TOutput;
  validation?: 'checked';
} & HandlerErrorOptions;
export type UncheckedContract<TInput, TOutput> = {
  input: UncheckedSchema<TInput>;
  output: UncheckedSchema<TOutput>;
  validation: 'unchecked';
  kind?: RpcHookKind;
  pagination?: InfinitePagination;
  responseValidator?: never;
};
export type UncheckedProcedureOptions<TInput, TOutput> = HandlerErrorOptions & {
  contract?: UncheckedContract<TInput, TOutput>;
};
export type RpcProcedureContracts = Readonly<Record<string, RpcContract>>;
export type RpcContractDefinition =
  | {
      input?: Schema<unknown, unknown>;
      output: Schema<unknown, unknown>;
      validation?: 'checked';
      kind?: RpcHookKind;
      pagination?: InfinitePagination;
      responseValidator?: Schema<unknown, unknown>;
    }
  | UncheckedContract<unknown, unknown>;
export type RpcProcedureDefinitions = Readonly<
  Record<string, RpcContractDefinition>
>;
export type ResponseValidatorConstraints<
  TDefinitions extends RpcProcedureDefinitions,
> = {
  [K in keyof TDefinitions]: {
    responseValidator?: Schema<
      InferSchemaOutput<NormalizedOutput<TDefinitions[K]>>,
      InferSchemaOutput<NormalizedOutput<TDefinitions[K]>>
    >;
  } & (IsPaginated<TDefinitions[K]> extends true
    ? {
        input?: InputSchema<TDefinitions[K]> &
          ObjectConstraint<
            InfiniteInputValue<InferSchemaInput<InputSchema<TDefinitions[K]>>>
          > &
          ObjectConstraint<
            InfiniteInputValue<InferSchemaOutput<InputSchema<TDefinitions[K]>>>
          >;
        output: TDefinitions[K]['output'] &
          ObjectConstraint<InferSchemaInput<TDefinitions[K]['output']>> &
          ObjectConstraint<InferSchemaOutput<TDefinitions[K]['output']>>;
      }
    : TDefinitions[K] extends { pagination: InfinitePagination }
      ? { pagination: never }
      : unknown);
};

type NormalizedRpcContract<D extends RpcContractDefinition> =
  D extends UncheckedContract<unknown, unknown>
    ? D
    : {
        input: NormalizedInput<D>;
        output: NormalizedOutput<D>;
        validation: 'checked';
        responseValidator?: D extends {
          responseValidator: infer S extends Schema<unknown, unknown>;
        }
          ? S
          : never;
      };
export type NormalizedRpcContracts<
  TDefinitions extends RpcProcedureDefinitions,
> = {
  [K in keyof TDefinitions]: NormalizedRpcContract<TDefinitions[K]> &
    HookMetadata &
    (TDefinitions[K] extends { kind: infer Kind extends RpcHookKind }
      ? { kind: Kind }
      : unknown) &
    (IsPaginated<TDefinitions[K]> extends true
      ? { pagination: ResolvedPagination<TDefinitions[K]> }
      : unknown);
};
export type RpcClient<
  TContracts extends RpcProcedureContracts,
  TError extends Error = Error,
> = {
  [K in keyof TContracts]: Client<
    Record<never, never>,
    InferSchemaInput<TContracts[K]['input']>,
    InferSchemaOutput<TContracts[K]['output']>,
    TError
  >;
};
export type QueryConnectionOptions = {
  origin?: string | URL | (() => string | URL | Promise<string | URL>);
  headers?: RPCLinkOptions<Record<never, never>>['headers'];
  linkOptions?: Omit<
    RPCLinkOptions<Record<never, never>>,
    'url' | 'fetch' | 'headers'
  >;
  keyPrefix?: readonly string[];
  fetch?: RpcFetch;
};
export type RpcEndpoint<
  TContracts extends RpcProcedureContracts = RpcProcedureContracts,
> = Readonly<{ path: `/${string}`; procedures: TContracts }>;

export type RpcImplementations<
  TContracts extends RpcProcedureContracts,
  TContext extends Context = Record<never, never>,
> = {
  [K in keyof TContracts]:
    | ((
        input: InferSchemaOutput<TContracts[K]['input']>,
        context: TContext,
      ) =>
        | InferSchemaInput<TContracts[K]['output']>
        | Promise<InferSchemaInput<TContracts[K]['output']>>)
    | AnyProcedure;
};

export type ArrayPaginationOptions = { cursor: number; pageSize: number };
export type ArrayPage<T> = {
  results: T[];
  total: number;
  nextCursor: number | null;
};
export type MissingArrayPage = {
  results: null;
  total: number;
  nextCursor: number | null;
};
export type PaginatedProcedureOptions<
  TInput extends Schema<unknown, { cursor: number }>,
  TItem,
  TOutput,
> = {
  input: TInput;
  output: Schema<ArrayPage<TItem> | MissingArrayPage, TOutput>;
  pageSize?: number;
} & HandlerErrorOptions;

export type PaginationOptions = { pageSize?: number };
