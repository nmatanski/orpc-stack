import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { createQueries } from 'orpc-stack/client';
import { defineRpcEndpoint } from 'orpc-stack/endpoint';
import { mountFastify } from 'orpc-stack/fastify';
import { expect, it } from 'vitest';
import { z } from 'zod';

class CounterService {
  getCount = async () => 42;
}
class AppModule {}
Module({ providers: [CounterService] })(AppModule);

it('mounts existing Nest services through the Fastify adapter', async () => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  const service = app.get(CounterService);
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();
  const endpoint = defineRpcEndpoint('/rpc', { count: { output: z.number() } });
  mountFastify(fastify, endpoint, { count: () => service.getCount() });
  await app.init();
  await fastify.ready();
  try {
    const queries = createQueries(endpoint, {
      origin: 'http://localhost',
      fetch: async (request) => {
        const result = await fastify.inject({
          method: 'POST',
          url: new URL(request.url).pathname,
          headers: Object.fromEntries(request.headers),
          payload: await request.text(),
        });
        return new Response(result.body, {
          status: result.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(await queries.count.call()).toBe(42);
  } finally {
    await app.close();
  }
});
