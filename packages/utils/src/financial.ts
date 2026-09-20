/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
export interface Installment {
  installmentNumber: number;
  principalDue: number;
  interestDue: number;
  totalDue: number;
}

export interface LoanSimulationResult {
  principal: number;
  tenorMonths: number;
  adminFee: number;
  interestRate: number;
  totalInterest: number;
  totalLoanAmount: number;
  installments: Installment[];
}

export const calculateTLaterLoan = (principalAmount: number, tenorMonths: number): LoanSimulationResult => {
  if (tenorMonths !== 1 && tenorMonths !== 3) {
    throw new Error('Invalid tenor, must be 1 or 3 months');
  }

  let adminFee = 0;
  let interestRate = 0;
  let totalInterest = 0;
  let totalLoanAmount = 0;
  const installments: Installment[] = [];

  if (tenorMonths === 1) {
    adminFee = principalAmount * 0.01;
    interestRate = 0;
    totalInterest = 0;
    totalLoanAmount = principalAmount + adminFee;
    
    installments.push({
      installmentNumber: 1,
      principalDue: principalAmount,
      interestDue: 0,
      totalDue: totalLoanAmount
    });
  } else if (tenorMonths === 3) {
    interestRate = 2.5;
    adminFee = 15000;
    totalInterest = principalAmount * (interestRate / 100) * 3;
    totalLoanAmount = principalAmount + totalInterest + adminFee;

    const monthlyInstallment = Math.round((totalLoanAmount / 3) * 100) / 100;
    let accumulated = 0;

    for (let i = 1; i <= 3; i++) {
      let installmentAmount = monthlyInstallment;
      
      if (i === 3) {
        installmentAmount = totalLoanAmount - accumulated;
      }
      
      installments.push({
        installmentNumber: i,
        principalDue: principalAmount / 3,
        interestDue: totalInterest / 3,
        totalDue: Math.round(installmentAmount * 100) / 100
      });
      
      accumulated += monthlyInstallment;
    }
  }

  return {
    principal: principalAmount,
    tenorMonths,
    adminFee,
    interestRate,
    totalInterest,
    totalLoanAmount,
    installments
  };
};
