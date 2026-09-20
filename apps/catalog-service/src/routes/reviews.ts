/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const reviewRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/products/:id/reviews', {
    preHandler: fastify.verifyAuth,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        orderId: Type.String(),
        rating: Type.Integer({ minimum: 1, maximum: 5 }),
        reviewText: Type.Optional(Type.String())
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { orderId, rating, reviewText } = request.body as any;
    const userId = (request as any).user.id;

    const productId = BigInt(id);
    const userBigInt = BigInt(userId);
    const orderBigInt = BigInt(orderId);

    const orderItem = await prisma.orderItem.findFirst({
      where: {
        productId: productId,
        orderId: orderBigInt,
        order: {
          userId: userBigInt,
          status: 'completed'
        }
      }
    });

    if (!orderItem) {
      return fastify.httpErrors.badRequest('You can only review products from completed orders.');
    }

    const existingReview = await prisma.productReview.findFirst({
      where: {
        productId: productId,
        userId: userBigInt,
        orderId: orderBigInt
      }
    });

    if (existingReview) {
      return fastify.httpErrors.conflict('You have already reviewed this product for this order.');
    }

    const review = await prisma.$transaction(async (tx: any) => {
      const createdReview = await tx.productReview.create({
        data: {
          productId,
          userId: userBigInt,
          orderId: orderBigInt,
          rating,
          reviewText
        }
      });

      const aggregations = await tx.productReview.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true }
      });

      const avgRating = aggregations._avg.rating ? Number(aggregations._avg.rating) : 0;
      const countRating = aggregations._count.rating || 0;

      await tx.product.update({
        where: { id: productId },
        data: {
          ratingAvg: avgRating,
          reviewCount: countRating
        }
      });

      return createdReview;
    });

    return reply.code(201).send({
      data: {
        id: review.id.toString(),
        productId: review.productId.toString(),
        orderId: review.orderId.toString(),
        rating: review.rating,
        reviewText: review.reviewText,
        createdAt: review.createdAt
      }
    });
  });

  fastify.get('/products/:id/reviews', {
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      querystring: Type.Object({
        page: Type.Optional(Type.Number({ default: 1 })),
        limit: Type.Optional(Type.Number({ default: 10 }))
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const { page, limit } = request.query as any;

    const productId = BigInt(id);
    const skip = ((page || 1) - 1) * (limit || 10);
    const take = limit || 10;

    const [product, total, reviews] = await Promise.all([
      prisma.product.findUnique({
        where: { id: productId },
        select: { ratingAvg: true, reviewCount: true }
      }),
      prisma.productReview.count({ where: { productId } }),
      prisma.productReview.findMany({
        where: { productId },
        skip,
        take,
        include: {
          user: {
            select: { name: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    if (!product) {
      return fastify.httpErrors.notFound('Product not found');
    }

    return {
      data: reviews.map((r: any) => ({
        id: r.id.toString(),
        userId: r.userId.toString(),
        userName: r.user?.name || 'Anonymous',
        rating: r.rating,
        reviewText: r.reviewText,
        createdAt: r.createdAt
      })),
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
        ratingAvg: product.ratingAvg ? Number(product.ratingAvg) : 0,
        reviewCount: product.reviewCount || 0
      }
    };
  });
};

export default reviewRoutes;
