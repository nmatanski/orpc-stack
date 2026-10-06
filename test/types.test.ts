import type { InferClientErrors } from '@orpc/client';
import type { InferSchemaInput } from '@orpc/server';
import { call } from '@orpc/server';
import type { RpcClient } from 'orpc-stack';
import { createQueries } from 'orpc-stack/client';
import {
  defineRpcEndpoint,
  defineUncheckedRpcContract,
} from 'orpc-stack/endpoint';
import {
  definePaginatedRpcProcedure,
  defineRpcProcedure,
  paginate,
} from 'orpc-stack/server';
import { expect, expectTypeOf, it } from 'vitest';
import * as yup from 'yup';
import { z } from 'zod';
import type { RpcContract } from '../src/types.js';

it('distinguishes checked contracts from branded unchecked contracts', () => {
  const schema = z.string();
  type InvalidUnchecked = {
    input: typeof schema;
    output: typeof schema;
    validation: 'unchecked';
  };
  expectTypeOf<InvalidUnchecked>().not.toExtend<RpcContract>();
  const endpoint = defineRpcEndpoint('/rpc', {
    checked: { output: schema },
    unchecked: defineUncheckedRpcContract<undefined, string>(),
  });
  expect(endpoint.procedures.checked.validation).toBe('checked');
  expect(endpoint.procedures.unchecked.validation).toBe('unchecked');
  expectTypeOf<
    InferSchemaInput<typeof endpoint.procedures.checked.input>
  >().toEqualTypeOf<undefined>();
});

it('preserves an explicitly supplied client error type', () => {
  const endpoint = defineRpcEndpoint('/rpc', { count: { output: z.number() } });
  type ExpectedError = Error & { code: 'CONFLICT' };
  type Client = RpcClient<typeof endpoint.procedures, ExpectedError>;
  expectTypeOf<
    InferClientErrors<Client>['count']
  >().toEqualTypeOf<ExpectedError>();
});

it('preserves all four schema boundaries and rejects incorrect client or handler types', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    date: {
      input: z.string().transform((value) => new Date(value)),
      output: z.string().transform((value) => new Date(value)),
      responseValidator: z.date(),
    },
    count: { output: z.number() },
    echo: defineUncheckedRpcContract<{ value: string }, { value: string }>(),
  });
  const procedure = defineRpcProcedure(async (input) => {
    expectTypeOf(input).toEqualTypeOf<Date>();
    return input.toISOString();
  }, endpoint.procedures.date);
  expect(procedure).toBeDefined();
  const queries = createQueries(endpoint, { origin: 'http://localhost' });
  expectTypeOf(queries.date.call).parameter(0).toEqualTypeOf<string>();
  expectTypeOf(queries.date.call).returns.resolves.toEqualTypeOf<Date>();
  expectTypeOf(queries.count.call).parameter(0).toEqualTypeOf<undefined>();
  expectTypeOf(queries.echo.call)
    .parameter(0)
    .toEqualTypeOf<{ value: string }>();
  expectTypeOf(queries.echo.call).returns.resolves.toEqualTypeOf<{
    value: string;
  }>();
  const invalidUsage = async () => {
    // @ts-expect-error The client sends the schema's wire input, not its parsed input.
    await queries.date.call(new Date());
    // @ts-expect-error No-input procedures do not accept arguments.
    await queries.count.call(1);
    // @ts-expect-error Unchecked contracts still enforce their declared input at compile time.
    await queries.echo.call({ value: 1 });
    defineRpcProcedure(
      // @ts-expect-error Handler input must be the parsed input schema type.
      async (input: string) => input,
      endpoint.procedures.date,
    );
    // @ts-expect-error Handler output must be the output schema's input, not its transformed output.
    defineRpcProcedure(async () => new Date(), endpoint.procedures.date);
  };
  expectTypeOf(invalidUsage).toBeFunction();
});

it('rejects unrelated or type-transforming response validators', () => {
  const invalidUsage = () => {
    defineRpcEndpoint('/rpc', {
      count: {
        output: z.number(),
        // @ts-expect-error The response validator must accept the parsed output type.
        responseValidator: z.string(),
      },
    });
    defineRpcEndpoint('/rpc', {
      count: {
        output: z.number(),
        // @ts-expect-error Response validation cannot change the response's type.
        responseValidator: z.number().transform((value) => String(value)),
      },
    });
  };
  expectTypeOf(invalidUsage).toBeFunction();
});

it('preserves extra paginated fields and transformed client boundaries with Zod', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      input: z.object({
        query: z.string(),
        game: z.boolean(),
        cursor: z.string().transform(Number),
      }),
      output: z.object({
        results: z.array(z.number().transform(String)),
        total: z.number(),
        nextCursor: z.number().nullable(),
      }),
    },
  });
  const procedure = definePaginatedRpcProcedure(
    async (input) => {
      expectTypeOf(input).toEqualTypeOf<{
        query: string;
        game: boolean;
        cursor: number;
      }>();
      expect(input).toEqual({ query: 'example', game: true, cursor: 1 });
      return [1, 2, 3];
    },
    { ...endpoint.procedures.list, pageSize: 1 },
  );
  const queries = createQueries(endpoint, { origin: 'https://example.test' });
  expectTypeOf(queries.list.call)
    .parameter(0)
    .toEqualTypeOf<{ query: string; game: boolean; cursor: string }>();
  expectTypeOf(queries.list.call).returns.resolves.toEqualTypeOf<{
    results: string[];
    total: number;
    nextCursor: number | null;
  }>();
  expect(
    await call(procedure, { query: 'example', game: true, cursor: '1' }),
  ).toEqual({ results: ['2'], total: 3, nextCursor: 2 });
  const invalidUsage = () => {
    // @ts-expect-error client cursor must be the schema input, not its parsed output
    queries.list.call({ query: 'example', game: true, cursor: 1 });
    // @ts-expect-error extra required fields must be present
    queries.list.call({ query: 'example', cursor: '1' });
    definePaginatedRpcProcedure(
      async () => ['wrong'],
      // @ts-expect-error handler must return array items before output transformation
      endpoint.procedures.list,
    );
  };
  expectTypeOf(invalidUsage).toBeFunction();
});

it('accepts Yup pagination schemas with cursor and extra required fields', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      input: yup
        .object({
          query: yup.string().required(),
          game: yup.boolean().required(),
          cursor: yup.number().integer().min(0).required(),
        })
        .required(),
      output: yup
        .object({
          results: yup.array(yup.number().required()).required(),
          total: yup.number().required(),
          nextCursor: yup.number().nullable().defined(),
        })
        .required(),
    },
  });
  const procedure = definePaginatedRpcProcedure(
    async (input) => {
      expectTypeOf(input).toEqualTypeOf<{
        query: string;
        game: boolean;
        cursor: number;
      }>();
      return [1, 2];
    },
    { ...endpoint.procedures.list, pageSize: 1 },
  );
  const queries = createQueries(endpoint, { origin: 'https://example.test' });
  expectTypeOf(queries.list.call)
    .parameter(0)
    .toEqualTypeOf<{ query: string; game: boolean; cursor: number }>();
  expectTypeOf(queries.list.call).returns.resolves.toEqualTypeOf<{
    results: number[];
    total: number;
    nextCursor: number | null;
  }>();
  expect(
    await call(procedure, { query: 'example', game: false, cursor: 0 }),
  ).toEqual({ results: [1], total: 2, nextCursor: 1 });
});

it('checks paginated plain functions against endpoint input and output schemas', () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      input: z.object({
        query: z.string(),
        game: z.boolean(),
        cursor: z.number(),
      }),
      output: z.object({
        results: z.array(z.number()),
        total: z.number(),
        nextCursor: z.number().nullable(),
      }),
    },
  });
  const list = paginate(async (input: { query: string; game: boolean }) =>
    input.game ? [1] : [],
  );
  const valid = { list } satisfies import('../src/types.js').RpcImplementations<
    typeof endpoint.procedures
  >;
  expect(valid.list).toBe(list);
  expectTypeOf(list)
    .parameter(0)
    .toEqualTypeOf<{ query: string; game: boolean } & { cursor: number }>();
  expectTypeOf(list).returns.resolves.toEqualTypeOf<{
    results: number[];
    total: number;
    nextCursor: number | null;
  }>();
  const invalidUsage = () => {
    const wrongOutput = {
      // @ts-expect-error the array element type must match the endpoint output before transforms
      list: paginate(async () => ['wrong']),
    } satisfies import('../src/types.js').RpcImplementations<
      typeof endpoint.procedures
    >;
    const wrongInput = {
      // @ts-expect-error handler arguments must match the endpoint's parsed input
      list: paginate(async (input: { query: number }) => [input.query]),
    } satisfies import('../src/types.js').RpcImplementations<
      typeof endpoint.procedures
    >;
    const nullable = {
      // @ts-expect-error a possibly missing array needs nullable results in the contract
      list: paginate(async () => null),
    } satisfies import('../src/types.js').RpcImplementations<
      typeof endpoint.procedures
    >;
    return { wrongOutput, wrongInput, nullable };
  };
  expectTypeOf(invalidUsage).toBeFunction();
});
