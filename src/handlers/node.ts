import type { AnyRouter, InferRouterInitialContext } from '@orpc/server';
import {
  type NodeHttpHandleResult,
  RPCHandler,
  type RPCHandlerOptions,
} from '@orpc/server/node';

type Context<R extends AnyRouter> = InferRouterInitialContext<R>;
type Request = Parameters<RPCHandler<Record<never, never>>['handle']>[0];
type Response = Parameters<RPCHandler<Record<never, never>>['handle']>[1];
type HandleOptions<R extends AnyRouter> = {
  prefix?: `/${string}`;
  context?: Context<R>;
};
type ContextFactory<R extends AnyRouter> = (
  request: Request,
  response: Response,
) => Context<R> | Promise<Context<R>>;

export function createNodeRpcHandler<R extends AnyRouter>(
  api: R,
  options: RPCHandlerOptions<Context<R>> & { context: ContextFactory<R> },
): {
  handle(
    request: Request,
    response: Response,
    options?: HandleOptions<R>,
  ): Promise<NodeHttpHandleResult>;
};
export function createNodeRpcHandler<R extends AnyRouter>(
  api: R,
  options?: RPCHandlerOptions<Context<R>>,
): RPCHandler<Context<R>>;
export function createNodeRpcHandler<R extends AnyRouter>(
  api: R,
  options: RPCHandlerOptions<Context<R>> & { context?: ContextFactory<R> } = {},
) {
  const { context, ...handlerOptions } = options;
  const handler = new RPCHandler<Context<R>>(api, handlerOptions);
  if (!context) return handler;
  const handle = handler.handle.bind(handler) as (
    request: Request,
    response: Response,
    options: { prefix?: `/${string}`; context: Context<R> },
  ) => Promise<NodeHttpHandleResult>;
  return {
    handle: async (
      request: Request,
      response: Response,
      options: HandleOptions<R> = {},
    ) =>
      handle(request, response, {
        ...options,
        context: options.context ?? (await context(request, response)),
      }),
  };
}
