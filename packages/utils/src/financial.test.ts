/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { describe, it, expect } from 'vitest';
import { calculateTLaterLoan } from './financial';

describe('Financial Utilities', () => {
  describe('calculateTLaterLoan', () => {
    it('should throw an error for invalid tenor months', () => {
      expect(() => calculateTLaterLoan(1000000, 2)).toThrowError('Invalid tenor, must be 1 or 3 months');
      expect(() => calculateTLaterLoan(1000000, 6)).toThrowError('Invalid tenor, must be 1 or 3 months');
    });

    it('should calculate loan correctly for 1 month tenor', () => {
      const principal = 1000000;
      const result = calculateTLaterLoan(principal, 1);

      expect(result.principal).toBe(principal);
      expect(result.tenorMonths).toBe(1);
      expect(result.adminFee).toBe(10000);
      expect(result.interestRate).toBe(0);
      expect(result.totalInterest).toBe(0);
      expect(result.totalLoanAmount).toBe(1010000);
      
      expect(result.installments.length).toBe(1);
      expect(result.installments[0]).toEqual({
        installmentNumber: 1,
        principalDue: 1000000,
        interestDue: 0,
        totalDue: 1010000
      });
    });

    it('should calculate loan correctly for 3 month tenor and balance pennies', () => {
      const principal = 1000000;
      const result = calculateTLaterLoan(principal, 3);

      expect(result.principal).toBe(principal);
      expect(result.tenorMonths).toBe(3);
      expect(result.adminFee).toBe(15000);
      expect(result.interestRate).toBe(2.5);
      expect(result.totalInterest).toBe(75000);
      expect(result.totalLoanAmount).toBe(1090000);
      expect(result.installments.length).toBe(3);
      
      expect(result.installments[0].totalDue).toBe(363333.33);
      expect(result.installments[1].totalDue).toBe(363333.33);
      expect(result.installments[2].totalDue).toBe(363333.34);
      
      const totalFromInstallments = result.installments.reduce((sum, inst) => sum + inst.totalDue, 0);
      expect(Math.round(totalFromInstallments * 100) / 100).toBe(1090000);
    });
    
    it('should handle penny-balancing correctly for an amount divisible by 3', () => {

      const principal = 900000;
      const result = calculateTLaterLoan(principal, 3);
      
      expect(result.totalLoanAmount).toBe(982500);
      expect(result.installments[0].totalDue).toBe(327500);
      expect(result.installments[1].totalDue).toBe(327500);
      expect(result.installments[2].totalDue).toBe(327500);
    });
  });
});
