import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import Redis from 'ioredis';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const cartRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/cart/add', {
    preHandler: fastify.verifyAuth,
    schema: {
      body: Type.Object({
        productId: Type.String(),
        quantity: Type.Number({ minimum: 1 })
      })
    }
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;
    const { productId, quantity } = request.body as any;

    const cartKey = `cart:${userId}`;
    
    // Check if product exists in catalog
    const product = await prisma.product.findUnique({
      where: { id: BigInt(productId) },
      include: { stock: true }
    });

    if (!product) return reply.notFound('Product not found');
    
    const availableStock = product.stock ? (product.stock.stock - product.stock.reservedStock) : 0;
    if (availableStock < quantity) {
      return reply.conflict('Insufficient stock');
    }

    // Store in redis hash: key=cart:userId, field=productId, value=quantity
    const currentQtyStr = await redis.hget(cartKey, productId);
    const newQty = currentQtyStr ? parseInt(currentQtyStr, 10) + quantity : quantity;

    if (newQty > availableStock) {
      return reply.conflict('Total quantity exceeds available stock');
    }

    await redis.hset(cartKey, productId, newQty.toString());

    return { success: true, message: 'Added to cart' };
  });

  fastify.get('/cart', {
    preHandler: fastify.verifyAuth
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;
    const cartKey = `cart:${userId}`;

    const cartData = await redis.hgetall(cartKey);
    const productIds = Object.keys(cartData).map(id => BigInt(id));

    if (productIds.length === 0) {
      return { data: { items: [], total: 0 } };
    }

    // Fetch product details from DB
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { stock: true }
    });

    let total = 0;
    const items = products.map(p => {
      const quantity = parseInt(cartData[p.id.toString()], 10);
      const subtotal = parseFloat(p.price.toString()) * quantity;
      total += subtotal;

      return {
        productId: p.id.toString(),
        name: p.name,
        price: p.price.toString(),
        quantity,
        subtotal,
        availableStock: p.stock ? (p.stock.stock - p.stock.reservedStock) : 0
      };
    });

    return {
      data: {
        items,
        total
      }
    };
  });

  fastify.delete('/cart/:productId', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        productId: Type.String()
      })
    }
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;
    const { productId } = request.params as any;

    const cartKey = `cart:${userId}`;
    await redis.hdel(cartKey, productId);

    return { success: true, message: 'Removed from cart' };
  });
};

export default cartRoutes;
