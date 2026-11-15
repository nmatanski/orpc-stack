import { createRpcHandler } from '../../handlers/fetch.js';
import { defineRpcApi } from '../../server.js';
import type {
  HandlerErrorOptions,
  RpcEndpoint,
  RpcImplementations,
  RpcProcedureContracts,
} from '../../types.js';

/** Export as POST from an App Router catch-all route matching endpoint.path. */
export const createNextHandler = <TContracts extends RpcProcedureContracts>(
  endpoint: RpcEndpoint<TContracts>,
  api: RpcImplementations<NoInfer<TContracts>>,
  options: HandlerErrorOptions = {},
) => {
  const handler = createRpcHandler(defineRpcApi(endpoint, api, options));
  return async (request: Request): Promise<Response> => {
    const result = await handler.handle(request, { prefix: endpoint.path });
    return result.matched
      ? result.response
      : new Response('Not found', { status: 404 });
  };
};
