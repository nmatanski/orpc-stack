import type { AxiosInstance } from 'axios';
import type { RpcFetch } from '../../types.js';

export const createAxiosTransport =
  (client: AxiosInstance): RpcFetch =>
  async (request) => {
    const response = await client.request<ArrayBuffer>({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      data: request.body ? await request.arrayBuffer() : undefined,
      signal: request.signal,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === 'string' || typeof value === 'number')
        headers.set(key, String(value));
      if (Array.isArray(value))
        for (const item of value) headers.append(key, String(item));
    }
    const body = [204, 205, 304].includes(response.status)
      ? null
      : response.data;
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
