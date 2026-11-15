import type { InferSchemaInput, InferSchemaOutput, Schema } from '@orpc/server';
import { call } from '@orpc/server';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { defineRpcApi } from 'orpc-stack/server';
import { expect, expectTypeOf, it } from 'vitest';
import * as yup from 'yup';
import { z } from 'zod';
import {
  augmentPaginationSchema,
  resolvePagination,
} from '../src/infinite-pagination.js';

it('adds configured pagination fields to all schema boundaries and handlers', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    search: {
      kind: 'infinite',
      pagination: { input: 'page', next: 'nextPage', initial: 1 },
      input: z.object({ query: z.string().transform((value) => value.trim()) }),
      output: z.object({ items: z.array(z.number().transform(String)) }),
      responseValidator: z.object({
        items: z.array(z.string()),
        nextPage: z.number().nullable(),
      }),
    },
  });
  expectTypeOf<
    InferSchemaInput<typeof endpoint.procedures.search.input>
  >().toEqualTypeOf<{ query: string; page: number }>();
  expectTypeOf<
    InferSchemaOutput<typeof endpoint.procedures.search.output>
  >().toEqualTypeOf<{ items: string[]; nextPage: number | null }>();
  const api = defineRpcApi(endpoint, {
    search: ({ query, page }) => {
      expectTypeOf(query).toEqualTypeOf<string>();
      expectTypeOf(page).toEqualTypeOf<number>();
      expect(query).toBe('example');
      return { items: [page], nextPage: null };
    },
  });
  const procedure = api.search;
  if (!procedure) throw new Error('Missing procedure');
  expect(await call(procedure, { query: ' example ', page: 1 })).toEqual({
    items: ['1'],
    nextPage: null,
  });
});

it('supports default cursor schemas with no other input', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    list: {
      kind: 'infinite',
      output: z.object({ items: z.array(z.string()) }),
    },
  });
  expectTypeOf<
    InferSchemaInput<typeof endpoint.procedures.list.input>
  >().toEqualTypeOf<{ cursor: number }>();
  expect(
    await endpoint.procedures.list.input['~standard'].validate({ cursor: 0 }),
  ).toEqual({ value: { cursor: 0 } });
  expect(
    await endpoint.procedures.list.output['~standard'].validate({
      items: [],
      nextCursor: null,
    }),
  ).toEqual({ value: { items: [], nextCursor: null } });
  expect(resolvePagination()).toEqual({
    input: 'cursor',
    next: 'nextCursor',
    initial: 0,
  });
  expect(resolvePagination({ input: 'offset' })).toEqual({
    input: 'offset',
    next: 'nextCursor',
    initial: 0,
  });
});

it('requires generated integer cursors at or above the configured initial value', async () => {
  const endpoint = defineRpcEndpoint('/rpc', {
    search: {
      kind: 'infinite',
      pagination: { initial: 1 },
      input: z.object({ query: z.string() }),
      output: z.object({ items: z.array(z.string()) }),
    },
  });
  const { input, output } = endpoint.procedures.search;
  expect(
    await input['~standard'].validate({ query: 'example', cursor: 1 }),
  ).toEqual({ value: { query: 'example', cursor: 1 } });
  for (const cursor of [undefined, null, 0, -1, 1.5, '1', NaN, Infinity]) {
    expect(
      await input['~standard'].validate({ query: 'example', cursor }),
    ).toMatchObject({ issues: [{ path: ['cursor'] }] });
  }
  expect(
    await input['~standard'].validate({ query: 'example' }),
  ).toHaveProperty('issues');
  for (const nextCursor of [1, 2, null]) {
    expect(
      await output['~standard'].validate({ items: [], nextCursor }),
    ).toEqual({ value: { items: [], nextCursor } });
  }
  for (const nextCursor of [undefined, 0, -1, 1.5]) {
    expect(
      await output['~standard'].validate({ items: [], nextCursor }),
    ).toMatchObject({ issues: [{ path: ['nextCursor'] }] });
  }
  const withDefault = augmentPaginationSchema(
    z.object({ cursor: z.number().default(1) }),
    'cursor',
    false,
    1,
  );
  expect(await withDefault['~standard'].validate({})).toEqual({
    value: { cursor: 1 },
  });
  const transformed = augmentPaginationSchema(
    z.object({ cursor: z.number().transform((value) => value + 0.5) }),
    'cursor',
    false,
    1,
  );
  expect(await transformed['~standard'].validate({ cursor: 1 })).toEqual({
    value: { cursor: 1.5 },
  });
});

it('retains explicit field refinements, async transforms and strict schemas', async () => {
  const schema = augmentPaginationSchema(
    z.strictObject({
      page: z.number().int().min(1),
      query: z.string().transform(async (value) => value.toUpperCase()),
    }),
    'page',
    false,
  );
  expect(
    await schema['~standard'].validate({ query: 'test', page: 1 }),
  ).toEqual({ value: { query: 'TEST', page: 1 } });
  expect(
    await schema['~standard'].validate({ query: 'test', page: 0 }),
  ).toHaveProperty('issues');
  expect(
    await schema['~standard'].validate({ query: 'test', page: 1.5 }),
  ).toHaveProperty('issues');
});

it('supports library-neutral Yup schemas that strip unknown keys', async () => {
  const schema = augmentPaginationSchema(
    yup.object({ query: yup.string().required() }).noUnknown(),
    'page',
    false,
  );
  expect(
    await schema['~standard'].validate({ query: 'example', page: 2 }),
  ).toEqual({ value: { query: 'example', page: 2 } });
});

it.each([undefined, null, [], 1, 'wrong'])(
  'rejects non-object pagination values: %s',
  async (value) => {
    expect(
      await augmentPaginationSchema(undefined, 'cursor', false)[
        '~standard'
      ].validate(value),
    ).toHaveProperty('issues');
  },
);

it.each([undefined, null, '1', NaN, Infinity, -Infinity])(
  'rejects invalid input pagination numbers: %s',
  async (cursor) => {
    expect(
      await augmentPaginationSchema(z.object({}), 'cursor', false)[
        '~standard'
      ].validate({ cursor }),
    ).toHaveProperty('issues');
  },
);

it.each([undefined, '1', NaN, Infinity])(
  'rejects invalid next-page values: %s',
  async (nextPage) => {
    expect(
      await augmentPaginationSchema(z.object({}), 'nextPage', true)[
        '~standard'
      ].validate({ nextPage }),
    ).toHaveProperty('issues');
  },
);

it('rejects schemas which transform objects into scalars', async () => {
  expect(
    await augmentPaginationSchema(
      z.object({}).transform(() => 1),
      'cursor',
      false,
    )['~standard'].validate({ cursor: 0 }),
  ).toHaveProperty('issues');
});

it('rejects inherited pagination fields', async () => {
  expect(
    await augmentPaginationSchema(z.object({}), 'cursor', false)[
      '~standard'
    ].validate(Object.create({ cursor: 0 })),
  ).toHaveProperty('issues');
});

it.each(['', '__proto__', 'constructor', 'prototype'])(
  'rejects invalid pagination field names: %s',
  (key) => {
    expect(() => resolvePagination({ input: key })).toThrow('property names');
    expect(() => resolvePagination({ next: key })).toThrow('property names');
  },
);

it.each([NaN, Infinity, -Infinity, -1, 0.5])(
  'rejects invalid starting values: %s',
  (initial) => {
    expect(() => resolvePagination({ initial })).toThrow(
      'non-negative safe integer',
    );
  },
);

it('rejects pagination metadata on non-infinite contracts at runtime', () => {
  const invalid: Record<
    string,
    { output: Schema<unknown, unknown>; pagination: { input: string } }
  > = { list: { output: z.object({}), pagination: { input: 'page' } } };
  // @ts-expect-error Pagination is only valid for infinite contracts.
  expect(() => defineRpcEndpoint('/rpc', invalid)).toThrow('kind: infinite');
});
