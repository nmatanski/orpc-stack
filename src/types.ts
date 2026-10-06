import type { Client } from '@orpc/client';
import type { RPCLinkOptions } from '@orpc/client/fetch';
import type {
  AnyProcedure,
  InferSchemaInput,
  InferSchemaOutput,
  Schema,
} from '@orpc/server';
export type RpcApi = Readonly<Record<string, AnyProcedure>>;
export type RpcFetch = NonNullable<
  RPCLinkOptions<Record<never, never>>['fetch']
>;
export type CheckedContract<
  TOutput extends Schema<unknown, unknown> = Schema<unknown, unknown>,
> = {
  input: Schema<unknown, unknown>;
  output: TOutput;
  validation: 'checked';
  responseValidator?: Schema<
    InferSchemaOutput<TOutput>,
    InferSchemaOutput<TOutput>
  >;
};
export type UncheckedSchema<T> = Schema<T, T> & {
  readonly '~orpc-stack': 'unchecked';
};
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
      InferSchemaOutput<TDefinitions[K]['output']>,
      InferSchemaOutput<TDefinitions[K]['output']>
    >;
  };
};

type NormalizedRpcContract<TDefinition extends RpcContractDefinition> =
  TDefinition extends UncheckedContract<unknown, unknown>
    ? TDefinition
    : {
        input: TDefinition extends {
          input: infer TInput extends Schema<unknown, unknown>;
        }
          ? TInput
          : Schema<undefined, undefined>;
        output: TDefinition['output'];
        validation: 'checked';
        responseValidator?: TDefinition extends {
          responseValidator: infer TSchema extends Schema<unknown, unknown>;
        }
          ? TSchema
          : never;
      };
export type NormalizedRpcContracts<
  TDefinitions extends RpcProcedureDefinitions,
> = {
  [K in keyof TDefinitions]: NormalizedRpcContract<TDefinitions[K]>;
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
  origin?: string | URL;
  keyPrefix?: readonly string[];
  fetch?: RpcFetch;
};
export type RpcEndpoint<
  TContracts extends RpcProcedureContracts = RpcProcedureContracts,
> = Readonly<{ path: `/${string}`; procedures: TContracts }>;

export type RpcImplementations<TContracts extends RpcProcedureContracts> = {
  [K in keyof TContracts]:
    | ((
        input: InferSchemaOutput<TContracts[K]['input']>,
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
