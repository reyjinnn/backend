import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import sensible from '@fastify/sensible';
import tlaterRoutes from './tlater';

const { prismaMock } = vi.hoisted(() => {
  const mock = {
    tlaterAccount: { findUnique: vi.fn(), update: vi.fn() },
    tlaterLoan: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    tlaterInstallment: { createMany: vi.fn(), count: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    tlaterRepayment: { create: vi.fn() },
    $transaction: vi.fn((callback) => callback(mock)),
    $queryRaw: vi.fn()
  };
  return { prismaMock: mock };
});

vi.mock('@tech-vibe/database', () => {
  return {
    PrismaClient: class {
      constructor() {
        return prismaMock;
      }
    }
  };
});

describe('TLater Routes', () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = fastify();
    await app.register(sensible);

    app.decorate('verifyAuth', async (request: any, reply: any) => {
      request.user = { id: '1' };
    });
    
    app.decorate('verifyInternalApiKey', async (request: any, reply: any) => {
    });

    app.register(tlaterRoutes);
  });

  describe('POST /tlater/simulate', () => {
    it('should simulate TLater loan for 1 month tenor correctly', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tlater/simulate',
        payload: {
          amount: '1000000',
          tenorMonths: 1
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.principal).toBe(1000000);
      expect(json.data.tenorMonths).toBe(1);
      expect(json.data.installments.length).toBe(1);
    });

    it('should simulate TLater loan for 3 month tenor correctly', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tlater/simulate',
        payload: {
          amount: '1000000',
          tenorMonths: 3
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.principal).toBe(1000000);
      expect(json.data.tenorMonths).toBe(3);
      expect(json.data.installments.length).toBe(3);
    });

    it('should fail simulation for invalid tenor', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tlater/simulate',
        payload: {
          amount: '1000000',
          tenorMonths: 2
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /tlater/account', () => {
    it('should return 404 if account not found', async () => {
      prismaMock.tlaterAccount.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/tlater/account'
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return account details if found', async () => {
      prismaMock.tlaterAccount.findUnique.mockResolvedValue({
        id: BigInt(1),
        userId: BigInt(1),
        creditLimit: 5000000,
        availableLimit: 5000000,
        status: 'active',
        interestRateMonthly: 2.5,
        lateFeeDaily: 1000
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/tlater/account'
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.id).toBe('1');
      expect(json.data.status).toBe('active');
    });
  });
});
