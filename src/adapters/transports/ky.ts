import ky from 'ky';
import type { RpcFetch } from '../../types.js';

export const kyTransport: RpcFetch = (request, init) =>
  ky(request, { ...init, throwHttpErrors: false, retry: 0 });
