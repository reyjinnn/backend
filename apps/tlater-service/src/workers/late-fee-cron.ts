/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import cron from 'node-cron';
import { PrismaClient } from '@tech-vibe/database';
import { logger } from '@tech-vibe/logger';

const prisma = new PrismaClient();

export const initLateFeeCron = () => {
  cron.schedule('1 0 * * *', async () => {
    logger.info('Starting late fee calculation cron job');
    
    try {
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
            const lockedInstallments: any[] = await tx.$queryRaw`
              SELECT id, principal_due, status FROM tlater_installments 
              WHERE id = ${installment.id} FOR UPDATE
            `;

            if (lockedInstallments.length === 0) return;
            const lockedInstallment = lockedInstallments[0];

            const dueDate = new Date(installment.dueDate);
            dueDate.setHours(0, 0, 0, 0);
            
            const diffTime = Math.abs(today.getTime() - dueDate.getTime());
            const daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLate > 0) {
              const lateFeeDailyRate = parseFloat(installment.loan.account.lateFeeDaily.toString()) / 100;
              const principalDue = parseFloat(lockedInstallment.principal_due);
              
              const lateFee = Math.round((principalDue * lateFeeDailyRate * daysLate) * 100) / 100;

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
