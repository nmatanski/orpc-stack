import { RPCHandler } from '@orpc/server/node';
import type { RpcApi } from '../types.js';

export const createNodeRpcHandler = (api: RpcApi) => new RPCHandler(api);
