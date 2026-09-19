import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const internalStocksRoutes: FastifyPluginAsync = async (fastify) => {
  
  // Protect all internal stock routes with the internal API key middleware
  fastify.addHook('preHandler', fastify.verifyInternalApiKey);

  fastify.post('/internal/stocks/reserve', {
    schema: {
      body: Type.Object({
        items: Type.Array(Type.Object({
          productId: Type.String(),
          quantity: Type.Number({ minimum: 1 })
        })),
        reservationMinutes: Type.Optional(Type.Number({ default: 15 }))
      })
    }
  }, async (request, reply) => {
    const { items, reservationMinutes } = request.body as any;
    
    // Sort items by productId to prevent deadlocks when locking multiple rows
    const sortedItems = [...items].sort((a, b) => {
      const idA = BigInt(a.productId);
      const idB = BigInt(b.productId);
      return idA < idB ? -1 : (idA > idB ? 1 : 0);
    });

    try {
      await prisma.$transaction(async (tx) => {
        for (const item of sortedItems) {
          const productId = BigInt(item.productId);
          
          // Row-level lock: SELECT ... FOR UPDATE
          const lockedRows: any[] = await tx.$queryRaw`
            SELECT product_id, stock, reserved_stock 
            FROM product_stocks 
            WHERE product_id = ${productId} 
            FOR UPDATE
          `;

          if (lockedRows.length === 0) {
            throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
          }

          const stockRow = lockedRows[0];
          const availableStock = stockRow.stock - stockRow.reserved_stock;

          if (availableStock < item.quantity) {
            throw new Error(`INSUFFICIENT_STOCK:${item.productId}`);
          }

          // Atomic update
          await tx.productStock.update({
            where: { productId },
            data: { reservedStock: { increment: item.quantity } }
          });
        }
      });

      return { success: true, message: 'Stock reserved successfully' };
    } catch (error: any) {
      if (error.message.startsWith('PRODUCT_NOT_FOUND')) {
        return reply.code(404).send({ 
          error: 'Not Found', 
          message: `Product ${error.message.split(':')[1]} not found` 
        });
      }
      if (error.message.startsWith('INSUFFICIENT_STOCK')) {
        return reply.code(409).send({ 
          error: 'Conflict', 
          message: `Insufficient stock for product ${error.message.split(':')[1]}` 
        });
      }
      throw error;
    }
  });

  fastify.post('/internal/stocks/release', {
    schema: {
      body: Type.Object({
        items: Type.Array(Type.Object({
          productId: Type.String(),
          quantity: Type.Number({ minimum: 1 })
        }))
      })
    }
  }, async (request, reply) => {
    const { items } = request.body as any;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.productStock.updateMany({
          where: { productId: BigInt(item.productId) },
          data: { reservedStock: { decrement: item.quantity } }
        });
      }
    });

    return { success: true, message: 'Stock released successfully' };
  });

  fastify.post('/internal/stocks/commit', {
    schema: {
      body: Type.Object({
        items: Type.Array(Type.Object({
          productId: Type.String(),
          quantity: Type.Number({ minimum: 1 })
        }))
      })
    }
  }, async (request, reply) => {
    const { items } = request.body as any;

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.productStock.updateMany({
          where: { productId: BigInt(item.productId) },
          data: { 
            stock: { decrement: item.quantity },
            reservedStock: { decrement: item.quantity } 
          }
        });
      }
    });

    return { success: true, message: 'Stock committed successfully' };
  });
};

export default internalStocksRoutes;
