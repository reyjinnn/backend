/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';
import '@fastify/sensible';

const prisma = new PrismaClient();

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/notifications', {
    preHandler: fastify.verifyAuth,
    schema: {
      querystring: Type.Object({
        page: Type.Optional(Type.Number({ default: 1 })),
        limit: Type.Optional(Type.Number({ default: 20 })),
        unreadOnly: Type.Optional(Type.Boolean())
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const { page, limit, unreadOnly } = request.query as any;

    const skip = ((page || 1) - 1) * (limit || 20);
    const take = limit || 20;

    const whereClause: any = { userId };
    if (unreadOnly) {
      whereClause.isRead = false;
    }

    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    return {
      data: notifications.map(n => ({
        id: n.id.toString(),
        userId: n.userId.toString(),
        title: n.title,
        message: n.body,
        isRead: n.isRead,
        createdAt: n.createdAt
      })),
      meta: {
        total,
        unreadCount,
        page: page || 1,
        limit: take
      }
    };
  });

  fastify.patch('/notifications/:id/read', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const notifId = BigInt((request.params as any).id);

    const notification = await prisma.notification.findUnique({
      where: { id: notifId }
    });

    if (!notification || notification.userId !== userId) {
      return fastify.httpErrors.notFound('Notification not found');
    }

    await prisma.notification.update({
      where: { id: notifId },
      data: { isRead: true }
    });

    return { message: 'Notification marked as read' };
  });

  fastify.post('/internal/notifications/trigger', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        title: Type.String(),
        message: Type.String()
      })
    }
  }, async (request, reply) => {
    const { userId, title, message } = request.body as any;

    await prisma.notification.create({
      data: {
        userId: BigInt(userId),
        title,
        body: message
      }
    });

    return reply.code(201).send({ message: 'Notification created successfully' });
  });
};

export default notificationRoutes;
