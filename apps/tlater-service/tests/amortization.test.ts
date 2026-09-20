/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import tlaterRoutes from '../src/routes/tlater';
import fp from 'fastify-plugin';

const mockPrisma = vi.hoisted(() => ({
  tLaterAccount: { findUnique: vi.fn(), update: vi.fn() },
  tLaterLoan: { create: vi.fn() },
  tLaterInstallment: { createMany: vi.fn() },
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
  fastify.decorate('verifyInternalApiKey', async (req: any, reply: any) => {
  });
});

import sensible from '@fastify/sensible';

describe('TLater Amortization Logic', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(sensible);
    await app.register(authMockPlugin);
    await app.register(tlaterRoutes);
    await app.ready();
  });

  it('should calculate amortization with penny-balancing correctly', async () => {
    mockPrisma.tLaterAccount.findUnique.mockResolvedValue({
      id: 1n, userId: 1n, creditLimit: 5000000, usedAmount: 0, status: 'active',
      interestRate: 2.0, lateFeeRate: 5.0
    });
    
    mockPrisma.tLaterLoan.create.mockResolvedValue({ id: 99n });

    const principalAmount = '1000000';
    const tenorMonths = 3;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tlater/disburse',
      headers: { 'x-internal-api-key': 'default-internal-secret' },
      payload: {
        userId: '1',
        orderId: '123',
        principalAmount,
        tenorMonths
      }
    });

    expect(response.statusCode).toBe(201);
    
    expect(mockPrisma.tLaterInstallment.createMany).toHaveBeenCalled();
    const callArgs = mockPrisma.tLaterInstallment.createMany.mock.calls[0][0];
    const data = callArgs.data;
    
    expect(data.length).toBe(3);
    

    expect(data[0].amountDue).toBe(353333);
    expect(data[1].amountDue).toBe(353333);
    expect(data[2].amountDue).toBe(353334);
    
    const totalAssigned = data.reduce((acc: number, curr: any) => acc + curr.amountDue, 0);
    expect(totalAssigned).toBe(1060000);
  });
});
