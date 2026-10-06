import { RPCHandler } from '@orpc/server/fetch';
import type { RpcApi } from '../types.js';

export const createRpcHandler = (api: RpcApi) => new RPCHandler(api);
