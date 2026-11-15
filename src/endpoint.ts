import {
  augmentPaginationSchema,
  inferPagination,
  resolvePagination,
} from './infinite-pagination.js';
import type {
  NoInputSchema,
  NormalizedRpcContracts,
  ResponseValidatorConstraints,
  RpcContract,
  RpcContractDefinition,
  RpcEndpoint,
  RpcProcedureContracts,
  RpcProcedureDefinitions,
  UncheckedContract,
  UncheckedSchema,
} from './types.js';

const noInputSchema: NoInputSchema = {
  '~orpc-stack': 'no-input',
  '~standard': {
    version: 1,
    vendor: 'orpc-stack/no-input',
    validate: (value) =>
      value === undefined
        ? { value }
        : { issues: [{ message: 'This procedure takes no input.' }] },
  },
};

const normalizeContract = (contract: RpcContractDefinition): RpcContract => {
  if (contract.validation === 'unchecked') return contract;
  const inferred = inferPagination(contract);
  if (
    contract.kind !== 'mutation' &&
    (contract.kind === 'infinite' || contract.pagination || inferred)
  ) {
    const pagination = resolvePagination({
      ...inferred,
      ...contract.pagination,
    });
    return {
      ...contract,
      pagination,
      input: augmentPaginationSchema(
        contract.input,
        pagination.input,
        false,
        pagination.initial,
      ),
      output: augmentPaginationSchema(
        contract.output,
        pagination.next,
        true,
        pagination.initial,
      ),
      validation: 'checked',
    };
  }
  if (contract.pagination)
    throw new Error('Pagination settings are not supported on mutations.');
  return {
    ...contract,
    input: contract.input ?? noInputSchema,
    validation: 'checked',
  };
};

const normalizeContracts = <TDefinitions extends RpcProcedureDefinitions>(
  definitions: TDefinitions,
): NormalizedRpcContracts<TDefinitions> => {
  const normalized: RpcProcedureContracts = Object.fromEntries(
    Object.entries(definitions).map(([name, contract]) => [
      name,
      normalizeContract(contract),
    ]),
  );
  return normalized as NormalizedRpcContracts<TDefinitions>;
};

const uncheckedSchema = <T>(): UncheckedSchema<T> => ({
  '~orpc-stack': 'unchecked',
  '~standard': {
    version: 1,
    vendor: 'orpc-stack/unchecked',
    // Unchecked mode deliberately trusts values; TypeScript types do not validate HTTP data.
    validate: (value) => ({ value: value as T }),
  },
});
export const defineUncheckedRpcContract = <
  TInput = undefined,
  TOutput = unknown,
>(): UncheckedContract<TInput, TOutput> => ({
  input: uncheckedSchema<TInput>(),
  output: uncheckedSchema<TOutput>(),
  validation: 'unchecked',
});

export function defineRpcEndpoint(
  path: `/${string}`,
): RpcEndpoint<Record<never, never>>;
export function defineRpcEndpoint<
  const TContracts extends RpcProcedureDefinitions,
>(
  path: `/${string}`,
  procedures: TContracts & ResponseValidatorConstraints<NoInfer<TContracts>>,
): RpcEndpoint<NormalizedRpcContracts<TContracts>>;
export function defineRpcEndpoint(
  path: `/${string}`,
  procedures: RpcProcedureDefinitions = {},
): RpcEndpoint {
  if (
    path.startsWith('//') ||
    path.endsWith('/') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('*') ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(
      'RPC endpoint must be a fixed absolute path without a trailing slash, query, or fragment.',
    );
  return Object.freeze({ path, procedures: normalizeContracts(procedures) });
}

export type { InfinitePagination } from './types.js';
