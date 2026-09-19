export const generateIdempotencyKey = (): string => {
  return crypto.randomUUID();
};

export * from './financial';
