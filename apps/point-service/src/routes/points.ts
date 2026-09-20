import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const pointsRoutes: FastifyPluginAsync = async (fastify) => {
  
  // ===========================================================================
  // PUBLIC ENDPOINTS
  // ===========================================================================

  fastify.get('/points/wallet', {
    preHandler: fastify.verifyAuth
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;

    let wallet = await prisma.pointWallet.findUnique({
      where: { userId: BigInt(userId) }
    });

    if (!wallet) {
      wallet = await prisma.pointWallet.create({
        data: {
          userId: BigInt(userId),
          balance: 0n,
          lockedBalance: 0n
        }
      });
    }

    return {
      data: {
        userId: wallet.userId.toString(),
        balance: wallet.balance.toString(),
        lockedBalance: wallet.lockedBalance.toString(),
        updatedAt: wallet.updatedAt
      }
    };
  });

  fastify.get('/points/history', {
    preHandler: fastify.verifyAuth,
    schema: {
      querystring: Type.Object({
        page: Type.Optional(Type.Number({ default: 1 })),
        limit: Type.Optional(Type.Number({ default: 10 }))
      })
    }
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;
    const { page, limit } = request.query as any;

    const skip = ((page || 1) - 1) * (limit || 10);
    const take = limit || 10;

    const [total, ledgers] = await Promise.all([
      prisma.pointLedger.count({ where: { userId: BigInt(userId) } }),
      prisma.pointLedger.findMany({
        where: { userId: BigInt(userId) },
        skip,
        take,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return {
      data: ledgers.map((l: any) => ({
        ...l,
        id: l.id.toString(),
        userId: l.userId.toString(),
        amount: l.amount.toString(),
        balanceAfter: l.balanceAfter.toString()
      })),
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    };
  });

  // ===========================================================================
  // INTERNAL ENDPOINTS (Idempotent & Double-Entry Ledger)
  // ===========================================================================
  
  fastify.post('/internal/points/hold-balance', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        amount: Type.String(),
        referenceId: Type.String(),
      }),
      headers: Type.Object({
        'idempotency-key': Type.String()
      })
    }
  }, async (request, reply) => {
    const { userId, amount, referenceId } = request.body as any;
    const idempotencyKey = request.headers['idempotency-key'] as string;
    const holdAmount = BigInt(amount);

    // 1. Idempotency Check
    const existingLedger = await prisma.pointLedger.findUnique({
      where: { idempotencyKey }
    });

    if (existingLedger) {
      return { data: { message: 'Hold already processed', ledgerId: existingLedger.id.toString() } };
    }

    // 2. Transaction: Lock wallet, check balance, update lockedBalance, create PENDING ledger
    try {
      const ledger = await prisma.$transaction(async (tx: any) => {
        // Lock row
        const wallets: any[] = await tx.$queryRaw`
          SELECT balance, locked_balance FROM point_wallets 
          WHERE user_id = ${BigInt(userId)} FOR UPDATE
        `;

        if (wallets.length === 0) {
          throw new Error('WALLET_NOT_FOUND');
        }

        const wallet = wallets[0];
        const available = wallet.balance - wallet.locked_balance;

        if (available < holdAmount) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        // Update locked balance
        await tx.pointWallet.update({
          where: { userId: BigInt(userId) },
          data: { lockedBalance: { increment: holdAmount } }
        });

        // Create PENDING ledger (no balance deducted yet, balanceAfter reflects current balance)
        const newLedger = await tx.pointLedger.create({
          data: {
            userId: BigInt(userId),
            idempotencyKey,
            type: 'debit',
            amount: holdAmount,
            balanceAfter: wallet.balance,
            referenceType: 'order_redemption',
            referenceId,
            description: 'Hold balance for order redemption',
            status: 'pending'
          }
        });

        return newLedger;
      });

      return { data: { message: 'Balance held successfully', ledgerId: ledger.id.toString() } };
    } catch (err: any) {
      if (err.message === 'WALLET_NOT_FOUND') return reply.notFound('Wallet not found');
      if (err.message === 'INSUFFICIENT_BALANCE') return reply.conflict('Insufficient available balance');
      throw err;
    }
  });

  fastify.post('/internal/points/commit-redemption', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        amount: Type.String(),
        referenceId: Type.String(),
        holdIdempotencyKey: Type.String()
      }),
      headers: Type.Object({
        'idempotency-key': Type.String()
      })
    }
  }, async (request, reply) => {
    const { userId, amount, referenceId, holdIdempotencyKey } = request.body as any;
    const commitIdempotencyKey = request.headers['idempotency-key'] as string;
    const commitAmount = BigInt(amount);

    // 1. Idempotency Check on Commit Request
    const existingCommitLedger = await prisma.pointLedger.findUnique({
      where: { idempotencyKey: commitIdempotencyKey }
    });

    if (existingCommitLedger) {
      return { data: { message: 'Commit already processed', ledgerId: existingCommitLedger.id.toString() } };
    }

    // 2. Transaction
    try {
      const ledger = await prisma.$transaction(async (tx: any) => {
        // Lock row
        const wallets: any[] = await tx.$queryRaw`
          SELECT balance, locked_balance FROM point_wallets 
          WHERE user_id = ${BigInt(userId)} FOR UPDATE
        `;

        if (wallets.length === 0) throw new Error('WALLET_NOT_FOUND');

        // Deduct from both balance and locked_balance
        const updatedWallet = await tx.pointWallet.update({
          where: { userId: BigInt(userId) },
          data: { 
            balance: { decrement: commitAmount },
            lockedBalance: { decrement: commitAmount }
          }
        });

        // Mark the hold ledger as completed
        await tx.pointLedger.update({
          where: { idempotencyKey: holdIdempotencyKey },
          data: { status: 'completed' }
        });

        // Create the COMMIT ledger entry to reflect the actual balance change
        const commitLedger = await tx.pointLedger.create({
          data: {
            userId: BigInt(userId),
            idempotencyKey: commitIdempotencyKey,
            type: 'debit',
            amount: commitAmount,
            balanceAfter: updatedWallet.balance,
            referenceType: 'order_redemption',
            referenceId,
            description: 'Committed balance deduction for order',
            status: 'completed'
          }
        });

        return commitLedger;
      });

      return { data: { message: 'Redemption committed successfully', ledgerId: ledger.id.toString() } };
    } catch (err: any) {
      if (err.message === 'WALLET_NOT_FOUND') return reply.notFound('Wallet not found');
      throw err;
    }
  });

  fastify.post('/internal/points/release-hold', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        amount: Type.String(),
        referenceId: Type.String(),
        holdIdempotencyKey: Type.String()
      }),
      headers: Type.Object({
        'idempotency-key': Type.String()
      })
    }
  }, async (request, reply) => {
    const { userId, amount, holdIdempotencyKey } = request.body as any;
    const releaseIdempotencyKey = request.headers['idempotency-key'] as string;
    const releaseAmount = BigInt(amount);

    // 1. Idempotency Check
    const existingReleaseLedger = await prisma.pointLedger.findUnique({
      where: { idempotencyKey: releaseIdempotencyKey }
    });

    if (existingReleaseLedger) {
      return { data: { message: 'Release already processed', ledgerId: existingReleaseLedger.id.toString() } };
    }

    try {
      const ledger = await prisma.$transaction(async (tx: any) => {
        // Lock row
        await tx.$queryRaw`SELECT balance FROM point_wallets WHERE user_id = ${BigInt(userId)} FOR UPDATE`;

        const updatedWallet = await tx.pointWallet.update({
          where: { userId: BigInt(userId) },
          data: { lockedBalance: { decrement: releaseAmount } }
        });

        // Cancel the hold
        await tx.pointLedger.update({
          where: { idempotencyKey: holdIdempotencyKey },
          data: { status: 'cancelled' }
        });

        // Create a release ledger to audit the cancellation
        const releaseLedger = await tx.pointLedger.create({
          data: {
            userId: BigInt(userId),
            idempotencyKey: releaseIdempotencyKey,
            type: 'credit', // virtual credit back to available, but overall balance unchanged
            amount: releaseAmount,
            balanceAfter: updatedWallet.balance,
            referenceType: 'refund',
            referenceId: holdIdempotencyKey,
            description: 'Released hold balance',
            status: 'completed'
          }
        });

        return releaseLedger;
      });

      return { data: { message: 'Hold released successfully', ledgerId: ledger.id.toString() } };
    } catch (err: any) {
      throw err;
    }
  });

  fastify.post('/internal/points/accrue-reward', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        amount: Type.String(),
        referenceId: Type.String(),
      }),
      headers: Type.Object({
        'idempotency-key': Type.String()
      })
    }
  }, async (request, reply) => {
    const { userId, amount, referenceId } = request.body as any;
    const idempotencyKey = request.headers['idempotency-key'] as string;
    const rewardAmount = BigInt(amount);

    // 1. Validasi Idempotency-Key
    const existingLedger = await prisma.pointLedger.findUnique({
      where: { idempotencyKey }
    });

    if (existingLedger) {
      // Jika kunci sudah pernah diproses, kembalikan data mutasi sebelumnya tanpa menduplikasi kredit
      return { 
        data: { 
          message: 'Reward already accrued', 
          ledger: {
            id: existingLedger.id.toString(),
            amount: existingLedger.amount.toString(),
            balanceAfter: existingLedger.balanceAfter.toString()
          }
        } 
      };
    }

    const ledger = await prisma.$transaction(async (tx: any) => {
      // Create wallet if not exist to prevent error on first time reward
      let wallet = await tx.pointWallet.findUnique({
        where: { userId: BigInt(userId) }
      });
      if (!wallet) {
        wallet = await tx.pointWallet.create({
          data: { userId: BigInt(userId), balance: 0n, lockedBalance: 0n }
        });
      }

      // Lock row
      await tx.$queryRaw`SELECT balance FROM point_wallets WHERE user_id = ${BigInt(userId)} FOR UPDATE`;

      const updatedWallet = await tx.pointWallet.update({
        where: { userId: BigInt(userId) },
        data: { balance: { increment: rewardAmount } }
      });

      const newLedger = await tx.pointLedger.create({
        data: {
          userId: BigInt(userId),
          idempotencyKey,
          type: 'credit',
          amount: rewardAmount,
          balanceAfter: updatedWallet.balance,
          referenceType: 'order_reward',
          referenceId,
          description: 'Cashback reward for completed order',
          status: 'completed'
        }
      });

      return newLedger;
    });

    return reply.code(201).send({
      data: {
        message: 'Reward accrued successfully',
        ledger: {
          id: ledger.id.toString(),
          amount: ledger.amount.toString(),
          balanceAfter: ledger.balanceAfter.toString()
        }
      }
    });
  });
};

export default pointsRoutes;
