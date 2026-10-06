import { RPCHandler } from '@orpc/server/fastify';
import type { FastifyInstance } from 'fastify';
import { defineRpcApi } from '../../server.js';
import type {
  HandlerErrorOptions,
  RpcEndpoint,
  RpcImplementations,
  RpcProcedureContracts,
} from '../../types.js';

export const mountFastify = <TContracts extends RpcProcedureContracts>(
  app: FastifyInstance,
  endpoint: RpcEndpoint<TContracts>,
  implementations: RpcImplementations<NoInfer<TContracts>>,
  options: HandlerErrorOptions = {},
) => {
  const handler = new RPCHandler(
    defineRpcApi(endpoint, implementations, options),
  );
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, _payload, done) =>
      done(null, undefined),
    );
    scope.all(`${endpoint.path}/*`, async (request, reply) => {
      const result = await handler.handle(request, reply, {
        prefix: endpoint.path,
      });
      if (result.matched) return reply;
      return reply.code(404).send({ error: 'Not found' });
    });
  });
  return app;
};
