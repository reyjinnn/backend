import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import buildServer from '../src/index';
import { PrismaClient } from '@tech-vibe/database';
import { FastifyInstance } from 'fastify';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Point Service Idempotency', () => {
  let app: FastifyInstance;
  let testUserId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    // Setup test user
    const user = await prisma.user.create({
      data: {
        name: 'Test Point User',
        email: `test-point-${Date.now()}@example.com`,
        phone: `+628${Date.now()}`,
        password_hash: 'hashed',
        role: 'customer'
      }
    });

    testUserId = user.id.toString();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.pointLedger.deleteMany({ where: { userId: BigInt(testUserId) } });
    await prisma.pointWallet.deleteMany({ where: { userId: BigInt(testUserId) } });
    await prisma.user.deleteMany({ where: { id: BigInt(testUserId) } });
    await app.close();
  });

  it('should only accrue reward once when called with the same idempotency key', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      userId: testUserId,
      amount: "1500", // 1500 points
      referenceId: "ORDER-TEST-123"
    };

    // 1st Call
    const res1 = await app.inject({
      method: 'POST',
      url: '/internal/points/accrue-reward',
      headers: {
        'x-internal-api-key': process.env.INTERNAL_API_KEY || 'default-internal-secret',
        'idempotency-key': idempotencyKey
      },
      payload
    });

    expect(res1.statusCode).toBe(201);
    const data1 = JSON.parse(res1.payload).data;
    expect(data1.message).toBe('Reward accrued successfully');

    // Verify DB
    const wallet1 = await prisma.pointWallet.findUnique({ where: { userId: BigInt(testUserId) } });
    expect(wallet1?.balance).toBe(1500n);

    // 2nd Call (Same Key)
    const res2 = await app.inject({
      method: 'POST',
      url: '/internal/points/accrue-reward',
      headers: {
        'x-internal-api-key': process.env.INTERNAL_API_KEY || 'default-internal-secret',
        'idempotency-key': idempotencyKey
      },
      payload
    });

    // Should return 200 with the exact same ledger info, but not increase balance
    expect(res2.statusCode).toBe(200);
    const data2 = JSON.parse(res2.payload).data;
    expect(data2.message).toBe('Reward already accrued');
    expect(data2.ledger.id).toBe(data1.ledger.id);

    // Verify DB
    const wallet2 = await prisma.pointWallet.findUnique({ where: { userId: BigInt(testUserId) } });
    expect(wallet2?.balance).toBe(1500n); // Balance should still be 1500, not 3000
    
    const ledgers = await prisma.pointLedger.findMany({ where: { idempotencyKey } });
    expect(ledgers.length).toBe(1); // Only 1 ledger entry
  });
});
