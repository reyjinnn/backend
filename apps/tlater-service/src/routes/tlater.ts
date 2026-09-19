import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';
import { calculateTLaterLoan } from '@tech-vibe/utils';

const prisma = new PrismaClient();

const tlaterRoutes: FastifyPluginAsync = async (fastify) => {
  
  // ===========================================================================
  // PUBLIC ENDPOINTS
  // ===========================================================================

  fastify.get('/tlater/account', {
    preHandler: fastify.verifyAuth
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;

    const account = await prisma.tlaterAccount.findUnique({
      where: { userId: BigInt(userId) }
    });

    if (!account) {
      return reply.notFound('TLater account not found');
    }

    return {
      data: {
        id: account.id.toString(),
        userId: account.userId.toString(),
        creditLimit: account.creditLimit.toString(),
        availableLimit: account.availableLimit.toString(),
        status: account.status,
        interestRateMonthly: account.interestRateMonthly.toString(),
        lateFeeDaily: account.lateFeeDaily.toString()
      }
    };
  });

  fastify.post('/tlater/simulate', {
    schema: {
      body: Type.Object({
        amount: Type.String(),
        tenorMonths: Type.Number()
      })
    }
  }, async (request, reply) => {
    const { amount, tenorMonths } = request.body as any;
    const principal = parseFloat(amount);

    try {
      const result = calculateTLaterLoan(principal, tenorMonths);
      return {
        data: {
          principal: result.principal,
          tenorMonths: result.tenorMonths,
          adminFee: result.adminFee,
          totalInterest: result.totalInterest,
          totalLoanAmount: result.totalLoanAmount,
          installments: result.installments
        }
      };
    } catch (err: any) {
      if (err.message.includes('Invalid tenor')) {
        return reply.badRequest(err.message);
      }
      throw err;
    }
  });

  fastify.post('/tlater/repay', {
    preHandler: fastify.verifyAuth,
    schema: {
      body: Type.Object({
        installmentId: Type.String(),
        amount: Type.String()
      })
    }
  }, async (request, reply) => {
    const { installmentId, amount } = request.body as any;
    const paymentAmount = parseFloat(amount);

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Lock installment
        const installments: any[] = await tx.$queryRaw`
          SELECT id, loan_id, principal_due, total_due, total_paid, status 
          FROM tlater_installments 
          WHERE id = ${BigInt(installmentId)} FOR UPDATE
        `;

        if (installments.length === 0) throw new Error('INSTALLMENT_NOT_FOUND');
        const installment = installments[0];

        if (installment.status === 'paid') throw new Error('ALREADY_PAID');

        const newTotalPaid = parseFloat(installment.total_paid) + paymentAmount;
        const requiredAmount = parseFloat(installment.total_due);
        const isFullyPaid = newTotalPaid >= requiredAmount;

        // Update installment
        await tx.tlaterInstallment.update({
          where: { id: BigInt(installmentId) },
          data: {
            totalPaid: newTotalPaid,
            status: isFullyPaid ? 'paid' : 'partially_paid',
            paidAt: isFullyPaid ? new Date() : null
          }
        });

        // Create repayment record
        const repayment = await tx.tlaterRepayment.create({
          data: {
            installmentId: BigInt(installmentId),
            paymentReference: `REP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            amount: paymentAmount
          }
        });

        // If installment is fully paid, restore available limit by principal due
        if (isFullyPaid) {
          const loan = await tx.tlaterLoan.findUnique({ where: { id: BigInt(installment.loan_id) } });
          if (loan) {
            await tx.tlaterAccount.update({
              where: { id: loan.accountId },
              data: { availableLimit: { increment: parseFloat(installment.principal_due) } }
            });

            // Check if all installments are paid
            const remainingInstallments = await tx.tlaterInstallment.count({
              where: { loanId: loan.id, status: { not: 'paid' } }
            });

            if (remainingInstallments === 0) {
              await tx.tlaterLoan.update({
                where: { id: loan.id },
                data: { status: 'fully_paid' }
              });
            }
          }
        }

        return repayment;
      });

      return { data: { message: 'Repayment successful', repaymentId: result.id.toString() } };
    } catch (err: any) {
      if (err.message === 'INSTALLMENT_NOT_FOUND') return reply.notFound('Installment not found');
      if (err.message === 'ALREADY_PAID') return reply.conflict('Installment already paid');
      throw err;
    }
  });

  // ===========================================================================
  // INTERNAL ENDPOINTS
  // ===========================================================================

  fastify.post('/internal/tlater/disburse', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        userId: Type.String(),
        orderId: Type.String(),
        principalAmount: Type.String(),
        tenorMonths: Type.Number()
      })
    }
  }, async (request, reply) => {
    const { userId, orderId, principalAmount, tenorMonths } = request.body as any;
    const amount = parseFloat(principalAmount);

    if (tenorMonths !== 1 && tenorMonths !== 3) {
      return reply.badRequest('Invalid tenor, must be 1 or 3 months');
    }

    try {
      const loan = await prisma.$transaction(async (tx) => {
        // Lock account
        const accounts: any[] = await tx.$queryRaw`
          SELECT id, available_limit, status FROM tlater_accounts 
          WHERE user_id = ${BigInt(userId)} FOR UPDATE
        `;

        if (accounts.length === 0) throw new Error('ACCOUNT_NOT_FOUND');
        const account = accounts[0];

        if (account.status !== 'active') throw new Error('ACCOUNT_NOT_ACTIVE');
        if (parseFloat(account.available_limit) < amount) throw new Error('INSUFFICIENT_LIMIT');

        // Calculate fees and installments using utility
        const calcResult = calculateTLaterLoan(amount, tenorMonths);
        
        // Deduct limit
        await tx.tlaterAccount.update({
          where: { id: BigInt(account.id) },
          data: { availableLimit: { decrement: amount } }
        });

        // Create Loan
        const newLoan = await tx.tlaterLoan.create({
          data: {
            accountId: BigInt(account.id),
            orderId: BigInt(orderId),
            loanCode: `LOAN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            principalAmount: amount,
            adminFee: calcResult.adminFee,
            interestRate: calcResult.interestRate,
            totalInterest: calcResult.totalInterest,
            totalLoanAmount: calcResult.totalLoanAmount,
            tenorMonths,
            status: 'active'
          }
        });

        // Create Installments
        const installmentsToCreate = calcResult.installments.map(inst => {
          const dueDate = new Date();
          // Adding ~30 days per installment number for simplification
          dueDate.setDate(dueDate.getDate() + (30 * inst.installmentNumber));
          
          return {
            loanId: newLoan.id,
            installmentNumber: inst.installmentNumber,
            principalDue: inst.principalDue,
            interestDue: inst.interestDue,
            totalDue: inst.totalDue,
            dueDate: dueDate,
            status: 'unpaid'
          };
        });

        // @ts-ignore
        await tx.tlaterInstallment.createMany({ data: installmentsToCreate });

        return newLoan;
      });

      return { data: { message: 'Loan disbursed successfully', loanId: loan.id.toString() } };
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') return reply.notFound('TLater account not found');
      if (err.message === 'ACCOUNT_NOT_ACTIVE') return reply.forbidden('TLater account is not active');
      if (err.message === 'INSUFFICIENT_LIMIT') return reply.conflict('Insufficient credit limit');
      throw err;
    }
  });

  fastify.post('/internal/tlater/cancel-loan', {
    preHandler: fastify.verifyInternalApiKey,
    schema: {
      body: Type.Object({
        orderId: Type.String()
      })
    }
  }, async (request, reply) => {
    const { orderId } = request.body as any;

    try {
      await prisma.$transaction(async (tx) => {
        // Find active loan for this order
        const loan = await tx.tlaterLoan.findUnique({
          where: { orderId: BigInt(orderId) }
        });

        if (!loan || loan.status !== 'active') {
          throw new Error('LOAN_NOT_CANCELLABLE');
        }

        // Lock account to restore limit
        const accounts: any[] = await tx.$queryRaw`
          SELECT id, available_limit FROM tlater_accounts 
          WHERE id = ${loan.accountId} FOR UPDATE
        `;

        if (accounts.length > 0) {
          // Restore available limit
          await tx.tlaterAccount.update({
            where: { id: loan.accountId },
            data: { availableLimit: { increment: loan.principalAmount } }
          });
        }

        // Delete unpaid installments
        await tx.tlaterInstallment.deleteMany({
          where: { loanId: loan.id, status: 'unpaid' }
        });

        // Delete the loan
        await tx.tlaterLoan.delete({
          where: { id: loan.id }
        });
      });

      return { success: true, message: 'TLater loan cancelled successfully' };
    } catch (err: any) {
      if (err.message === 'LOAN_NOT_CANCELLABLE') {
        return reply.badRequest('Loan not found or already processed');
      }
      throw err;
    }
  });

};

export default tlaterRoutes;
