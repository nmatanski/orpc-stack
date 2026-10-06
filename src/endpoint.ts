import type { Schema } from '@orpc/server';
import type {
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

const noInputSchema: Schema<undefined, undefined> = {
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
export function defineRpcEndpoint<TContracts extends RpcProcedureDefinitions>(
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
