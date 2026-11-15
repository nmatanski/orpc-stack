import type { Schema } from '@orpc/server';
import type { InfinitePagination, RpcContractDefinition } from './types.js';

// Standard Schema only specifies validation. Recognize the public object-field
// metadata exposed by Zod and Yup without running user validators or transforms.
const schemaFields = (schema: Schema<unknown, unknown> | undefined) => {
  if (!schema) return undefined;
  if ('shape' in schema && isRecord(schema.shape)) return schema.shape;
  if ('fields' in schema && isRecord(schema.fields)) return schema.fields;
  return undefined;
};

export const inferPagination = (
  contract: RpcContractDefinition,
): InfinitePagination | undefined => {
  if (contract.kind === 'mutation') return undefined;
  const input = schemaFields(contract.input);
  const output = schemaFields(contract.output);
  if (!input || !output) return undefined;
  if (Object.hasOwn(input, 'cursor') && Object.hasOwn(output, 'nextCursor')) {
    return { input: 'cursor', next: 'nextCursor', initial: 0 };
  }
  if (Object.hasOwn(input, 'page') && Object.hasOwn(output, 'nextPage')) {
    return { input: 'page', next: 'nextPage', initial: 1 };
  }
  return undefined;
};

export const resolvePagination = (settings: InfinitePagination = {}) => {
  const result = {
    input: settings.input ?? 'cursor',
    next: settings.next ?? 'nextCursor',
    initial: settings.initial ?? 0,
  };
  for (const key of [result.input, result.next]) {
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error(
        'Pagination fields must be non-empty, safe property names.',
      );
    }
  }
  if (!Number.isSafeInteger(result.initial) || result.initial < 0)
    throw new Error(
      'Initial pagination value must be a non-negative safe integer.',
    );
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const augmentPaginationSchema = (
  schema: Schema<unknown, unknown> | undefined,
  key: string,
  nullable: boolean,
  minimum = 0,
): Schema<unknown, unknown> => ({
  '~standard': {
    version: 1,
    vendor: 'orpc-stack/infinite',
    validate: async (value) => {
      if (!isRecord(value))
        return {
          issues: [{ message: 'Infinite pagination requires an object.' }],
        };
      const validField = (field: unknown) =>
        (nullable && field === null) ||
        (typeof field === 'number' &&
          Number.isSafeInteger(field) &&
          field >= minimum);
      const invalidField = () => ({
        issues: [
          {
            message: `Expected a pagination integer >= ${minimum}${nullable ? ' or null' : ''}.`,
            path: [key],
          },
        ],
      });
      const rawField = Object.hasOwn(value, key) ? value[key] : undefined;
      const result = schema
        ? await schema['~standard'].validate(value)
        : { value: {} };
      if (result.issues) return result;
      if (!isRecord(result.value))
        return {
          issues: [
            { message: 'Infinite pagination schemas must produce objects.' },
          ],
        };
      // Fields produced by the user's schema follow its rules, including
      // nullable cursors and transforms. Only generated fields use the defaults.
      if (Object.hasOwn(result.value, key)) return result;
      if (!validField(rawField)) return invalidField();
      return { value: { ...result.value, [key]: rawField } };
    },
  },
});
