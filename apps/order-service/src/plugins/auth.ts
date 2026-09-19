import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (request: any, reply: any) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Since API Gateway handles JWT and passes x-user-id, we just check this header
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
