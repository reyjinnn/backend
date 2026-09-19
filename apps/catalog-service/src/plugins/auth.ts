import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    verifyAdmin: (request: any, reply: any) => Promise<void>;
    verifyInternalApiKey: (request: any, reply: any) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('verifyAdmin', async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.unauthorized('Missing or invalid authorization header');
    }
    const token = authHeader.split(' ')[1];
    
    if (token !== 'mock-admin-token') {
      return reply.forbidden('Requires admin privileges');
    }
  });

  fastify.decorate('verifyInternalApiKey', async (request: any, reply: any) => {
    const apiKey = request.headers['x-internal-api-key'];
    const expectedKey = process.env.INTERNAL_API_KEY || 'default-internal-secret';
    
    if (!apiKey || apiKey !== expectedKey) {
      return reply.unauthorized('Invalid internal API key');
    }
  });
};

export default fp(authPlugin);
