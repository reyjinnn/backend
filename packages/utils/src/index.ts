/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
export const generateIdempotencyKey = (): string => {
  return crypto.randomUUID();
};

export * from './financial';
