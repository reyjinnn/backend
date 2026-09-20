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

const addressRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    preHandler: fastify.verifyAuth
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    
    const addresses = await prisma.userAddress.findMany({
      where: { userId },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return {
      data: addresses.map(addr => ({
        id: addr.id.toString(),
        userId: addr.userId.toString(),
        label: addr.label,
        recipientName: addr.recipientName,
        phone: addr.phone,
        addressLine: addr.addressLine,
        city: addr.city,
        postalCode: addr.postalCode,
        isPrimary: addr.isPrimary,
        createdAt: addr.createdAt
      }))
    };
  });

  fastify.post('/', {
    preHandler: fastify.verifyAuth,
    schema: {
      body: Type.Object({
        label: Type.Optional(Type.String()),
        recipientName: Type.String(),
        phone: Type.String(),
        fullAddress: Type.String(),
        city: Type.String(),
        postalCode: Type.String(),
        isPrimary: Type.Optional(Type.Boolean())
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const body = request.body as any;

    const address = await prisma.$transaction(async (tx) => {
      if (body.isPrimary) {
        await tx.userAddress.updateMany({
          where: { userId, isPrimary: true },
          data: { isPrimary: false }
        });
      }

      let makePrimary = body.isPrimary || false;
      if (!makePrimary) {
        const existingCount = await tx.userAddress.count({ where: { userId } });
        if (existingCount === 0) {
          makePrimary = true;
        }
      }

      return await tx.userAddress.create({
        data: {
          userId,
          label: body.label || 'Rumah',
          recipientName: body.recipientName,
          phone: body.phone,
          addressLine: body.fullAddress,
          city: body.city,
          postalCode: body.postalCode,
          isPrimary: makePrimary
        }
      });
    });

    return reply.code(201).send({
      message: 'Address created successfully',
      data: {
        id: address.id.toString(),
        isPrimary: address.isPrimary
      }
    });
  });

  fastify.patch('/:id/primary', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const addressId = BigInt((request.params as any).id);

    const address = await prisma.userAddress.findUnique({
      where: { id: addressId }
    });

    if (!address || address.userId !== userId) {
      return fastify.httpErrors.notFound('Address not found');
    }

    if (address.isPrimary) {
      return { message: 'Address is already primary' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.userAddress.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false }
      });

      await tx.userAddress.update({
        where: { id: addressId },
        data: { isPrimary: true }
      });
    });

    return { message: 'Primary address updated successfully' };
  });

  fastify.delete('/:id', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const userId = BigInt((request as any).user.id);
    const addressId = BigInt((request.params as any).id);

    const address = await prisma.userAddress.findUnique({
      where: { id: addressId }
    });

    if (!address || address.userId !== userId) {
      return fastify.httpErrors.notFound('Address not found');
    }

    if (address.isPrimary) {
      return fastify.httpErrors.badRequest('Cannot delete primary address. Set another address as primary first.');
    }

    await prisma.userAddress.delete({
      where: { id: addressId }
    });

    return { message: 'Address deleted successfully' };
  });
};

export default addressRoutes;
