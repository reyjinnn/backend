import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (request: any, reply: any) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('verifyAuth', async (request: any, reply: any) => {
    const userId = request.headers['x-user-id'];
    const role = request.headers['x-user-role'];
    
    if (!userId) {
      return reply.unauthorized('Missing x-user-id header from API Gateway');
    }
    
    request.user = { id: userId, role: role || 'customer' };
  });
};

export default fp(authPlugin);
