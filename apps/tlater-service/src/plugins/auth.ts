import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (request: any, reply: any) => Promise<void>;
    verifyInternalApiKey: (request: any, reply: any) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Mocked JWT verification for User Endpoints
  fastify.decorate('verifyAuth', async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.unauthorized('Missing or invalid authorization header');
    }
    const token = authHeader.split(' ')[1];
    
    // Mocked for Sprint 2, assume token is 'user-1-token'
    if (token === 'user-1-token') {
      request.user = { id: 1, role: 'customer' };
    } else {
      return reply.unauthorized('Invalid token');
    }
  });

  // Internal API Key verification
  // NOTE: Ensure /internal/* routes are isolated from public access at the infrastructure level (VPC / API Gateway).
  fastify.decorate('verifyInternalApiKey', async (request: any, reply: any) => {
    const apiKey = request.headers['x-internal-api-key'];
    const expectedKey = process.env.INTERNAL_API_KEY || 'default-internal-secret';
    
    if (!apiKey || apiKey !== expectedKey) {
      request.log.warn({ url: request.url, ip: request.ip }, 'Unauthorized internal access attempt');
      return reply.unauthorized('Invalid internal API key');
    }
  });
};

export default fp(authPlugin);
