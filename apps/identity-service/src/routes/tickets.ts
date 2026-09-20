/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient, TicketCategory } from '@tech-vibe/database';
import '@fastify/sensible';

const prisma = new PrismaClient();

const ticketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/tickets', {
    preHandler: fastify.verifyAuth,
    schema: {
      body: Type.Object({
        subject: Type.String(),
        category: Type.Enum(TicketCategory),
        message: Type.String()
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const body = request.body as any;

    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const ticketId = `TVC-${dateStr}-${randomSuffix}`;

    const ticket = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.supportTicket.create({
        data: {
          id: ticketId,
          userId,
          subject: body.subject,
          category: body.category,
          status: 'open'
        }
      });

      await tx.ticketMessage.create({
        data: {
          ticketId,
          senderType: 'user',
          senderId: userId,
          message: body.message
        }
      });

      return newTicket;
    });

    return reply.code(201).send({
      message: 'Support ticket created',
      data: {
        id: ticket.id,
        status: ticket.status
      }
    });
  });

  fastify.get('/tickets', {
    preHandler: fastify.verifyAuth,
    schema: {
      querystring: Type.Object({
        status: Type.Optional(Type.String())
      })
    }
  }, async (request, reply) => {
    const user = (request as any).user;
    const { status } = request.query as any;

    const whereClause: any = {};
    if (user.role === 'customer') {
      whereClause.userId = BigInt(user.id);
    } else if (user.role === 'admin' || user.role === 'superadmin') {
      if (status) {
        whereClause.status = status;
      }
    } else {
      return fastify.httpErrors.forbidden('Unknown role');
    }

    const tickets = await prisma.supportTicket.findMany({
      where: whereClause,
      include: {
        user: { select: { name: true, email: true } },
        _count: { select: { messages: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      data: tickets.map(t => ({
        id: t.id,
        userId: t.userId.toString(),
        userName: t.user.name,
        userEmail: t.user.email,
        subject: t.subject,
        category: t.category,
        status: t.status,
        messageCount: t._count.messages,
        createdAt: t.createdAt
      }))
    };
  });

  fastify.post('/tickets/:id/reply', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        message: Type.String(),
        senderType: Type.Union([Type.Literal('user'), Type.Literal('admin')])
      })
    }
  }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as any;
    const { message, senderType } = request.body as any;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id }
    });

    if (!ticket) {
      return fastify.httpErrors.notFound('Ticket not found');
    }

    if (user.role === 'customer' && ticket.userId !== BigInt(user.id)) {
      return fastify.httpErrors.forbidden('Cannot reply to others ticket');
    }

    if (user.role === 'customer' && senderType === 'admin') {
      return fastify.httpErrors.forbidden('Customers cannot send as admin');
    }

    await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        senderType: senderType,
        senderId: BigInt(user.id),
        message
      }
    });

    await prisma.supportTicket.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    return reply.code(201).send({ message: 'Reply sent' });
  });

  fastify.patch('/admin/tickets/:id/status', {
    preHandler: fastify.verifyAdmin,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        status: Type.Union([
          Type.Literal('open'),
          Type.Literal('in_progress'),
          Type.Literal('completed')
        ])
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id }
    });

    if (!ticket) {
      return fastify.httpErrors.notFound('Ticket not found');
    }

    await prisma.supportTicket.update({
      where: { id },
      data: { status }
    });

    return { message: `Ticket status updated to ${status}` };
  });
};

export default ticketRoutes;
