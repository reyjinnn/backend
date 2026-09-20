import cron from 'node-cron';
import { PrismaClient } from '@tech-vibe/database';
import { logger } from '@tech-vibe/logger';

const prisma = new PrismaClient();

export const initLateFeeCron = () => {
  // Run every day at 00:01 AM
  cron.schedule('1 0 * * *', async () => {
    logger.info('Starting late fee calculation cron job');
    
    try {
      // Find all unpaid installments past due date
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdueInstallments = await prisma.tlaterInstallment.findMany({
        where: {
          status: { in: ['unpaid', 'partially_paid', 'overdue'] },
          dueDate: { lt: today }
        },
        include: {
          loan: {
            include: {
              account: true
            }
          }
        }
      });

      logger.info(`Found ${overdueInstallments.length} overdue installments`);

      for (const installment of overdueInstallments) {
        try {
          await prisma.$transaction(async (tx: any) => {
            // Lock installment
            const lockedInstallments: any[] = await tx.$queryRaw`
              SELECT id, principal_due, status FROM tlater_installments 
              WHERE id = ${installment.id} FOR UPDATE
            `;

            if (lockedInstallments.length === 0) return;
            const lockedInstallment = lockedInstallments[0];

            // Calculate days late
            const dueDate = new Date(installment.dueDate);
            dueDate.setHours(0, 0, 0, 0);
            
            const diffTime = Math.abs(today.getTime() - dueDate.getTime());
            const daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLate > 0) {
              const lateFeeDailyRate = parseFloat(installment.loan.account.lateFeeDaily.toString()) / 100;
              const principalDue = parseFloat(lockedInstallment.principal_due);
              
              // late_fee = principal_due * (late_fee_daily / 100) * hari_terlambat
              const lateFee = Math.round((principalDue * lateFeeDailyRate * daysLate) * 100) / 100;

              // Calculate new total due
              const interestDue = parseFloat(installment.interestDue.toString());
              const newTotalDue = principalDue + interestDue + lateFee;

              await tx.tlaterInstallment.update({
                where: { id: installment.id },
                data: {
                  lateFee,
                  totalDue: newTotalDue,
                  status: 'overdue'
                }
              });
            }
          });
        } catch (err) {
          logger.error({ err, installmentId: installment.id.toString() }, 'Failed to process late fee for installment');
        }
      }

      logger.info('Finished late fee calculation cron job');
    } catch (error) {
      logger.error({ error }, 'Failed to run late fee cron job');
    }
  });
};
