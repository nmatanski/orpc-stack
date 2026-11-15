import type {
  AnyProcedure,
  Context,
  InferSchemaInput,
  InferSchemaOutput,
  Schema,
} from '@orpc/server';
import { isProcedure, os } from '@orpc/server';
import { paginate } from './pagination.js';

export { paginate, paginateArray } from './pagination.js';

import { defineUncheckedRpcContract } from './endpoint.js';
import type {
  CheckedProcedureOptions,
  HandlerErrorOptions,
  PaginatedProcedureOptions,
  RpcEndpoint,
  RpcImplementations,
  RpcProcedureContracts,
  UncheckedProcedureOptions,
} from './types.js';

export const defineRpcProcedure = <
  TInput extends Schema<unknown, unknown>,
  TOutput extends Schema<unknown, unknown>,
  TContext extends Context = Record<never, never>,
>(
  handler: (
    input: InferSchemaOutput<TInput>,
    context: TContext,
  ) => InferSchemaInput<TOutput> | Promise<InferSchemaInput<TOutput>>,
  options: CheckedProcedureOptions<TInput, TOutput>,
) =>
  os
    .$context<TContext>()
    .input(options.input)
    .output(options.output)
    .handler(async ({ input, context }) => {
      try {
        return await handler(input, context);
      } catch (error) {
        throw options.mapHandlerError ? options.mapHandlerError(error) : error;
      }
    });
export const defineUncheckedRpcProcedure = <
  TInput = undefined,
  TOutput = unknown,
  TContext extends Context = Record<never, never>,
>(
  handler: (input: TInput, context: TContext) => TOutput | Promise<TOutput>,
  options: UncheckedProcedureOptions<TInput, TOutput> = {},
) => {
  const contract =
    options.contract ?? defineUncheckedRpcContract<TInput, TOutput>();
  return os
    .$context<TContext>()
    .input(contract.input)
    .output(contract.output)
    .handler(async ({ input, context }) => {
      try {
        return await handler(input, context);
      } catch (error) {
        throw options.mapHandlerError ? options.mapHandlerError(error) : error;
      }
    });
};

export type BoundRpcApi<
  C extends RpcProcedureContracts,
  TContext extends Context = Record<never, never>,
> = {
  [K in keyof C]: ReturnType<
    typeof defineRpcProcedure<C[K]['input'], C[K]['output'], TContext>
  >;
};

export function defineRpcApi<
  C extends RpcProcedureContracts,
  const I extends { [K in keyof C]: AnyProcedure },
>(
  endpoint: RpcEndpoint<C>,
  implementations: I,
  options?: HandlerErrorOptions,
): I;
export function defineRpcApi<
  C extends RpcProcedureContracts,
  TContext extends Context = Record<never, never>,
>(
  endpoint: RpcEndpoint<C>,
  implementations: RpcImplementations<NoInfer<C>, TContext>,
  options?: HandlerErrorOptions,
): BoundRpcApi<C, TContext>;
export function defineRpcApi(
  endpoint: RpcEndpoint,
  implementations: object,
  options: HandlerErrorOptions = {},
): Readonly<Record<string, AnyProcedure>> {
  for (const key of Object.keys(endpoint.procedures)) {
    if (!Object.hasOwn(implementations, key))
      throw new Error(`Missing RPC implementation: ${key}`);
  }
  return Object.fromEntries(
    Object.entries(implementations as Record<string, unknown>).map(
      ([key, implementation]) => {
        if (isProcedure(implementation)) return [key, implementation];
        const contract = endpoint.procedures[key];
        if (!contract) throw new Error(`Missing RPC contract: ${key}`);
        if (typeof implementation !== 'function')
          throw new Error(`Invalid RPC implementation: ${key}`);
        return [
          key,
          defineRpcProcedure(
            (input: unknown, context: Context) => {
              const output: unknown = Reflect.apply(implementation, undefined, [
                input,
                context,
              ]);
              return output;
            },
            { input: contract.input, output: contract.output, ...options },
          ),
        ];
      },
    ),
  );
}

export const definePaginatedRpcProcedure = <
  TInput extends Schema<unknown, { cursor: number }>,
  TItem,
  TOutput,
>(
  handler: (
    input: InferSchemaOutput<TInput>,
  ) => readonly TItem[] | null | Promise<readonly TItem[] | null>,
  options: PaginatedProcedureOptions<TInput, TItem, TOutput>,
) => {
  return defineRpcProcedure(paginate(handler, options), options);
};
