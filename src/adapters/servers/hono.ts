import type { Hono } from 'hono';
import { routePath } from 'hono/route';
import { createRpcHandler } from '../../handlers/fetch.js';
import { defineRpcApi } from '../../server.js';
import type {
  HandlerErrorOptions,
  RpcEndpoint,
  RpcImplementations,
  RpcProcedureContracts,
} from '../../types.js';

export const mountHono = <TContracts extends RpcProcedureContracts>(
  app: Hono,
  endpoint: RpcEndpoint<TContracts>,
  api: RpcImplementations<NoInfer<TContracts>>,
  options: HandlerErrorOptions = {},
) => {
  const handler = createRpcHandler(defineRpcApi(endpoint, api, options));
  app.all(`${endpoint.path}/*`, async (c) => {
    const prefix = `/${routePath(c).slice(1, -2)}` as const;
    const result = await handler.handle(c.req.raw, { prefix });
    if (!result.matched) return c.notFound();
    return c.newResponse(result.response.body, result.response);
  });
  return app;
};
