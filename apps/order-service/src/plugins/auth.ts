/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import fp from 'fastify-plugin';
import { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    verifyAuth: (request: any, reply: any) => Promise<void>;
    verifyAdmin: (request: any, reply: any) => Promise<void>;
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

  fastify.decorate('verifyAdmin', async (request: any, reply: any) => {
    const role = request.headers['x-user-role'];
    if (role !== 'admin' && role !== 'superadmin') {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== 'mock-admin-token') {
        return reply.forbidden('Requires admin privileges');
      }
    }
  });
};

export default fp(authPlugin);
