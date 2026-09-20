import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const wishlistRoutes: FastifyPluginAsync = async (fastify) => {
  // Add or remove product from wishlist
  fastify.post('/products/:id/wishlist', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const userId = (request as any).user.id;

    const productId = BigInt(id);
    const userBigInt = BigInt(userId);

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return fastify.httpErrors.notFound('Product not found');
    }

    const existingWishlist = await prisma.wishlist.findUnique({
      where: {
        userId_productId: {
          userId: userBigInt,
          productId: productId
        }
      }
    });

    if (existingWishlist) {
      await prisma.wishlist.delete({
        where: {
          userId_productId: {
            userId: userBigInt,
            productId: productId
          }
        }
      });
      return { message: 'Product removed from wishlist', added: false };
    } else {
      await prisma.wishlist.create({
        data: {
          userId: userBigInt,
          productId: productId
        }
      });
      return { message: 'Product added to wishlist', added: true };
    }
  });

  // Get user's wishlist
  fastify.get('/wishlist', {
    preHandler: fastify.verifyAuth
  }, async (request, reply) => {
    const userId = (request as any).user.id;

    const wishlists = await prisma.wishlist.findMany({
      where: { userId: BigInt(userId) },
      include: {
        product: {
          include: {
            images: { where: { isPrimary: true }, take: 1 }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      data: wishlists.map(w => ({
        ...w.product,
        id: w.product.id.toString(),
        price: Number(w.product.price),
        addedAt: w.createdAt
      }))
    };
  });
};

export default wishlistRoutes;
