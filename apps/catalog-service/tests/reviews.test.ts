/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import reviewRoutes from '../src/routes/reviews';
import fp from 'fastify-plugin';

const mockPrisma = vi.hoisted(() => ({
  orderItem: { findFirst: vi.fn() },
  productReview: { findFirst: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  product: { update: vi.fn() },
  $transaction: vi.fn(async (cb) => {
    return cb(mockPrisma);
  })
}));

vi.mock('@tech-vibe/database', () => ({
  PrismaClient: class {
    constructor() { return mockPrisma; }
  }
}));

const authMockPlugin = fp(async (fastify) => {
  fastify.decorate('verifyAuth', async (req: any) => {
    req.user = { id: '1', role: 'customer' };
  });
});

import sensible from '@fastify/sensible';

describe('Product Reviews Integration Tests', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(sensible);
    await app.register(authMockPlugin);
    await app.register(reviewRoutes);
    await app.ready();
  });

  it('should reject review if order is not completed', async () => {
    mockPrisma.orderItem.findFirst.mockResolvedValue(null); // Simulate no completed order item found

    const response = await app.inject({
      method: 'POST',
      url: '/products/1/reviews',
      payload: {
        orderId: '123',
        rating: 5,
        reviewText: 'Great!'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).message).toContain('completed orders');
  });

  it('should reject review if user already reviewed this order item', async () => {
    mockPrisma.orderItem.findFirst.mockResolvedValue({ id: 10n });
    mockPrisma.productReview.findFirst.mockResolvedValue({ id: 99n }); // Review exists

    const response = await app.inject({
      method: 'POST',
      url: '/products/1/reviews',
      payload: {
        orderId: '123',
        rating: 5,
        reviewText: 'Great!'
      }
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload).message).toContain('already reviewed');
  });

  it('should accept valid review and update average rating', async () => {
    mockPrisma.orderItem.findFirst.mockResolvedValue({ id: 10n });
    mockPrisma.productReview.findFirst.mockResolvedValue(null); // No previous review
    
    mockPrisma.productReview.create.mockResolvedValue({
      id: 99n, productId: 1n, userId: 1n, orderId: 123n, rating: 5, reviewText: 'Great!', createdAt: new Date()
    });
    
    mockPrisma.productReview.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { rating: 2 }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/products/1/reviews',
      payload: {
        orderId: '123',
        rating: 5,
        reviewText: 'Great!'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.data.id).toBe('99');
    
    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1n },
      data: { ratingAvg: 4.5, reviewCount: 2 }
    }));
  });
});
