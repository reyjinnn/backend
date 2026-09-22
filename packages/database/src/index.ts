/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
// Polyfill BigInt serialization globally
if (typeof BigInt.prototype !== "undefined") {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

export * from "@prisma/client";
