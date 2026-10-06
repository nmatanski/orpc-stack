import { createORPCClient } from '@orpc/client';
import type { RPCLinkOptions } from '@orpc/client/fetch';
import { RPCLink } from '@orpc/client/fetch';

import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type {
  QueryConnectionOptions,
  RpcClient,
  RpcEndpoint,
  RpcProcedureContracts,
} from './types.js';

export const createQueries = <
  TContracts extends RpcProcedureContracts,
  TError extends Error = Error,
>(
  endpoint: RpcEndpoint<TContracts>,
  options: QueryConnectionOptions = {},
) => {
  const configuredOrigin = options.origin
    ? new URL(options.origin).origin
    : undefined;
  const linkOptions: RPCLinkOptions<Record<never, never>> = {
    url: () => {
      const origin = configuredOrigin ?? globalThis.location?.origin;
      if (!origin)
        throw new Error('Provide origin when calling RPC outside a browser.');
      return new URL(endpoint.path, origin);
    },
    interceptors: [
      async ({ path, next }) => {
        const result = await next();
        const schema = endpoint.procedures[path.join('.')]?.responseValidator;
        if (!schema) return result;
        const validated = await schema['~standard'].validate(result);
        if (validated.issues)
          throw new Error('RPC response validation failed.');
        return result;
      },
    ],
  };
  if (options.fetch) linkOptions.fetch = options.fetch;
  const client: RpcClient<TContracts, TError> = createORPCClient(
    new RPCLink(linkOptions),
  );
  return createTanstackQueryUtils(client, {
    path: [
      ...(options.keyPrefix ?? [
        'orpc-stack',
        configuredOrigin ?? 'same-origin',
        endpoint.path,
      ]),
    ],
  });
};
