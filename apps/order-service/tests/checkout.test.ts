/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import checkoutRoutes from '../src/routes/checkout';
import fp from 'fastify-plugin';

const mockPrisma = vi.hoisted(() => ({
  product: { findUnique: vi.fn(), findMany: vi.fn() },
  promo: { findUnique: vi.fn(), update: vi.fn() },
  order: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  orderPayment: { createMany: vi.fn() },
  orderItem: { createMany: vi.fn() },
  userPromoUsage: { create: vi.fn() },
  $transaction: vi.fn((cb) => cb(mockPrisma))
}));

vi.mock('@tech-vibe/database', () => ({
  PrismaClient: class {
    constructor() { return mockPrisma; }
  }
}));

vi.mock('axios', () => {
  const postMock = vi.fn().mockResolvedValue({ data: { success: true, pointsDeducted: 0, newBalance: 0 } });
  return {
    default: { post: postMock },
    post: postMock
  };
});

const authMockPlugin = fp(async (fastify) => {
  fastify.decorate('verifyAuth', async (req: any) => {
    req.user = { id: '1', role: 'customer' };
  });
});

import sensible from '@fastify/sensible';

describe('Checkout Integration Tests', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(sensible);
    await app.register(authMockPlugin);
    await app.register(checkoutRoutes);
    await app.ready();
  });

  it('should reject promo if quota is exhausted', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([{
      id: 1n, price: 100000, stock: 10, internalStock: 10, isActive: true, name: 'Test'
    }]);
    mockPrisma.promo.findUnique.mockResolvedValue({
      id: 1, code: 'HABIS', minPurchase: 50000, maxDiscount: 20000,
      valueType: 'nominal', value: 10000,
      startDate: new Date(Date.now() - 10000), status: 'active',
      endDate: new Date(Date.now() + 10000), usedCount: 100, quota: 100
    });

    const response = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { 'idempotency-key': 'test-idem-1' },
      payload: {
        items: [{ productId: '1', quantity: 1 }],
        shippingAddress: '123 Test St',
        insuranceSelected: false,
        promoCode: 'HABIS',
        paymentSplit: {
          usePointsAmount: 0,
          useTlater: false,
          gatewayCashAmount: 100000
        }
      }
    });

    console.log(response.payload);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).message).toContain('Promo quota reached');
  });

  it('should reject promo if subtotal is below minPurchase', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([{
      id: 1n, price: 30000, stock: 10, internalStock: 10, isActive: true, name: 'Test'
    }]);
    mockPrisma.promo.findUnique.mockResolvedValue({
      id: 1, code: 'MIN50', minPurchase: 50000, maxDiscount: 20000,
      valueType: 'nominal', value: 10000,
      startDate: new Date(Date.now() - 10000), status: 'active',
      endDate: new Date(Date.now() + 10000), usedCount: 50, quota: 100
    });

    const response = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { 'idempotency-key': 'test-idem-2' },
      payload: {
        items: [{ productId: '1', quantity: 1 }],
        shippingAddress: '123 Test St',
        insuranceSelected: false,
        promoCode: 'MIN50',
        paymentSplit: {
          usePointsAmount: 0,
          useTlater: false,
          gatewayCashAmount: 30000
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).message).toContain('Minimum purchase of');
  });

  it('should calculate split-payment correctly with insurance and promo', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockPrisma.product.findMany.mockResolvedValue([{
      id: 1n, price: 100000, stock: 10, internalStock: 10, isActive: true, name: 'Test'
    }]);
    mockPrisma.promo.findUnique.mockResolvedValue({
      id: 1, code: 'DISKON10', minPurchase: 50000, maxDiscount: 20000,
      valueType: 'persen', value: 10,
      startDate: new Date(Date.now() - 10000), status: 'active',
      endDate: new Date(Date.now() + 10000), usedCount: 50, quota: 100
    });
    
    mockPrisma.order.create.mockResolvedValue({
      id: 123n,
      userId: 1n,
      totalAmount: 95000 // 100000 - 10000 (promo) + 5000 (insurance)
    });

    const response = await app.inject({
      method: 'POST',
      url: '/orders/checkout',
      headers: { 'idempotency-key': 'test-idem-3' },
      payload: {
        items: [{ productId: '1', quantity: 1 }],
        shippingAddress: '123 Test St',
        insuranceSelected: true,
        promoCode: 'DISKON10',
        paymentSplit: {
          usePointsAmount: 5000,
          useTlater: false,
          gatewayCashAmount: 130000
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    
    
    expect(mockPrisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        grandTotal: 135000,
        insuranceFee: 20000,
        shippingFee: 25000,
        discountAmount: 10000
      })
    }));
    
    expect(mockPrisma.orderPayment.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ paymentMethod: 'point', amount: 5000 }),
        expect.objectContaining({ paymentMethod: 'gateway_cash', amount: 130000 })
      ])
    }));
  });
});
