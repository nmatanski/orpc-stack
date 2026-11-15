import type { AnyRouter, InferRouterInitialContext } from '@orpc/server';
import {
  type FetchHandleResult,
  RPCHandler,
  type RPCHandlerOptions,
} from '@orpc/server/fetch';

type Context<R extends AnyRouter> = InferRouterInitialContext<R>;
type ContextFactory<R extends AnyRouter> = (
  request: Request,
) => Context<R> | Promise<Context<R>>;
type FactoryHandleOptions<R extends AnyRouter> = {
  prefix?: `/${string}`;
  context?: Context<R>;
};

export function createRpcHandler<R extends AnyRouter>(
  api: R,
  options: RPCHandlerOptions<Context<R>> & { context: ContextFactory<R> },
): {
  handle(
    request: Request,
    options?: FactoryHandleOptions<R>,
  ): Promise<FetchHandleResult>;
};
export function createRpcHandler<R extends AnyRouter>(
  api: R,
  options?: RPCHandlerOptions<Context<R>>,
): RPCHandler<Context<R>>;
export function createRpcHandler<R extends AnyRouter>(
  api: R,
  options: RPCHandlerOptions<Context<R>> & { context?: ContextFactory<R> } = {},
) {
  const { context, ...handlerOptions } = options;
  const handler = new RPCHandler<Context<R>>(api, handlerOptions);
  if (!context) return handler;
  const handle = handler.handle.bind(handler) as (
    request: Request,
    options: { prefix?: `/${string}`; context: Context<R> },
  ) => Promise<FetchHandleResult>;
  return {
    handle: async (request: Request, options: FactoryHandleOptions<R> = {}) =>
      handle(request, {
        ...options,
        context: options.context ?? (await context(request)),
      }),
  };
}
