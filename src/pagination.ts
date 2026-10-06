import type {
  ArrayPage,
  ArrayPaginationOptions,
  MissingArrayPage,
  PaginationOptions,
} from './types.js';

export const paginateArray = <T>(
  items: readonly T[],
  { cursor, pageSize }: ArrayPaginationOptions,
): ArrayPage<T> => {
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new RangeError(
      'Pagination cursor must be a non-negative safe integer.',
    );
  if (!Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new RangeError(
      'Pagination page size must be a positive safe integer.',
    );
  const remaining = items.length - cursor;
  return {
    results: items.slice(cursor, cursor + pageSize),
    total: items.length,
    nextCursor: pageSize < remaining ? cursor + pageSize : null,
  };
};

export function paginate<TInput, TItem>(
  handler: (input: TInput) => readonly TItem[] | Promise<readonly TItem[]>,
  options?: PaginationOptions,
): (input: TInput & { cursor: number }) => Promise<ArrayPage<TItem>>;
export function paginate<TInput, TItem>(
  handler: (
    input: TInput,
  ) => readonly TItem[] | null | Promise<readonly TItem[] | null>,
  options?: PaginationOptions,
): (
  input: TInput & { cursor: number },
) => Promise<ArrayPage<TItem> | MissingArrayPage>;
export function paginate<TInput, TItem>(
  handler: (
    input: TInput,
  ) => readonly TItem[] | null | Promise<readonly TItem[] | null>,
  options: PaginationOptions = {},
) {
  const pageSize = options.pageSize ?? 20;
  paginateArray([], { cursor: 0, pageSize });
  return async (
    input: TInput & { cursor: number },
  ): Promise<ArrayPage<TItem> | MissingArrayPage> => {
    paginateArray([], { cursor: input.cursor, pageSize });
    const items = await handler(input);
    if (items === null) return { results: null, total: 0, nextCursor: null };
    return paginateArray(items, { cursor: input.cursor, pageSize });
  };
}
