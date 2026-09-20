/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export interface InternalAuthPluginOptions {
  internalToken: string;
}

const internalAuth: FastifyPluginAsync<InternalAuthPluginOptions> = async (fastify, options) => {
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/internal/')) {
      const token = request.headers['x-internal-token'];
      if (!token || token !== options.internalToken) {
        request.log.warn({ url: request.url, ip: request.ip }, 'Unauthorized internal access attempt');
        return reply.status(403).send({ error: 'Forbidden', message: 'Invalid or missing internal token' });
      }
    }
  });
};

export default fp(internalAuth, {
  name: 'internal-auth',
});
