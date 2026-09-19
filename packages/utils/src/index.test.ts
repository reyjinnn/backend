import { describe, it, expect } from 'vitest';
import { generateIdempotencyKey } from './index';

describe('Index Utilities', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate a valid UUID string', () => {
      const key = generateIdempotencyKey();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(36);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(key).toMatch(uuidRegex);
    });

    it('should generate unique keys', () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();
      expect(key1).not.toBe(key2);
    });
  });
});
