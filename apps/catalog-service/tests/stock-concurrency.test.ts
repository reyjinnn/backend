import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import buildServer from '../src/index';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();
import { FastifyInstance } from 'fastify';

describe('Stock Concurrency (Row-Level Locking)', () => {
  let app: FastifyInstance;
  let testProductId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    // Setup test product and stock
    const category = await prisma.category.create({
      data: {
        name: 'Test Category',
        slug: `test-category-${Date.now()}`
      }
    });

    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `TEST-SKU-${Date.now()}`,
        name: 'Concurrency Test Product',
        slug: `concurrency-test-${Date.now()}`,
        price: 100.00,
        stock: {
          create: {
            stock: 1, // Only 1 stock available
            reservedStock: 0
          }
        }
      }
    });

    testProductId = product.id.toString();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.productStock.deleteMany({ where: { productId: BigInt(testProductId) } });
    await prisma.product.deleteMany({ where: { id: BigInt(testProductId) } });
    await app.close();
  });

  it('should only allow 1 successful reservation out of 20 concurrent requests', async () => {
    const concurrentRequests = 20;
    
    // Create 20 promises simulating concurrent requests to reserve 1 item
    const requests = Array.from({ length: concurrentRequests }).map(() => {
      return app.inject({
        method: 'POST',
        url: '/internal/stocks/reserve',
        headers: {
          'x-internal-api-key': process.env.INTERNAL_API_KEY || 'default-internal-secret'
        },
        payload: {
          items: [{ productId: testProductId, quantity: 1 }]
        }
      });
    });

    const responses = await Promise.all(requests);

    const successResponses = responses.filter(r => r.statusCode === 200);
    const conflictResponses = responses.filter(r => r.statusCode === 409);
    
    // Exactly 1 request should succeed
    expect(successResponses.length).toBe(1);
    // The rest (19) should fail with 409 Conflict
    expect(conflictResponses.length).toBe(concurrentRequests - 1);

    // Verify database state: stock = 1, reserved_stock = 1
    const stockRow = await prisma.productStock.findUnique({
      where: { productId: BigInt(testProductId) }
    });

    expect(stockRow?.stock).toBe(1);
    expect(stockRow?.reservedStock).toBe(1);
  });
});
