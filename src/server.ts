import type { InferSchemaInput, InferSchemaOutput, Schema } from '@orpc/server';
import { isProcedure, os } from '@orpc/server';
import { paginate } from './pagination.js';

export { paginate, paginateArray } from './pagination.js';

import { defineUncheckedRpcContract } from './endpoint.js';
import type {
  CheckedProcedureOptions,
  HandlerErrorOptions,
  PaginatedProcedureOptions,
  RpcApi,
  RpcEndpoint,
  RpcImplementations,
  RpcProcedureContracts,
  UncheckedProcedureOptions,
} from './types.js';

export const defineRpcProcedure = <
  TInput extends Schema<unknown, unknown>,
  TOutput extends Schema<unknown, unknown>,
>(
  handler: (
    input: InferSchemaOutput<TInput>,
  ) => InferSchemaInput<TOutput> | Promise<InferSchemaInput<TOutput>>,
  options: CheckedProcedureOptions<TInput, TOutput>,
) =>
  os
    .input(options.input)
    .output(options.output)
    .handler(async ({ input }) => {
      try {
        return await handler(input);
      } catch (error) {
        throw options.mapHandlerError ? options.mapHandlerError(error) : error;
      }
    });
export const defineUncheckedRpcProcedure = <
  TInput = undefined,
  TOutput = unknown,
>(
  handler: (input: TInput) => TOutput | Promise<TOutput>,
  options: UncheckedProcedureOptions<TInput, TOutput> = {},
) => {
  const contract =
    options.contract ?? defineUncheckedRpcContract<TInput, TOutput>();
  return os
    .input(contract.input)
    .output(contract.output)
    .handler(async ({ input }) => {
      try {
        return await handler(input);
      } catch (error) {
        throw options.mapHandlerError ? options.mapHandlerError(error) : error;
      }
    });
};

export const defineRpcApi = <TContracts extends RpcProcedureContracts>(
  endpoint: RpcEndpoint<TContracts>,
  implementations: RpcImplementations<NoInfer<TContracts>>,
  options: HandlerErrorOptions = {},
): RpcApi => {
  for (const key of Object.keys(endpoint.procedures)) {
    if (!Object.hasOwn(implementations, key))
      throw new Error(`Missing RPC implementation: ${key}`);
  }
  return Object.fromEntries(
    Object.entries(implementations).map(([key, implementation]) => {
      if (isProcedure(implementation)) return [key, implementation];
      const contract = endpoint.procedures[key];
      if (!contract) throw new Error(`Missing RPC contract: ${key}`);
      if (typeof implementation !== 'function')
        throw new Error(`Invalid RPC implementation: ${key}`);
      return [
        key,
        defineRpcProcedure(
          (input: unknown) => {
            const output: unknown = Reflect.apply(implementation, undefined, [
              input,
            ]);
            return output;
          },
          { input: contract.input, output: contract.output, ...options },
        ),
      ];
    }),
  );
};

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
