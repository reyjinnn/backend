export const generateIdempotencyKey = (): string => {
  return crypto.randomUUID();
};
