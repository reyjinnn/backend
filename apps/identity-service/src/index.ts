import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { logger } from "@tech-vibe/logger";
import { PrismaClient } from "@tech-vibe/database";

import { authRoutes } from "./routes/auth";
import { kycRoutes } from "./routes/kyc";

const prisma = new PrismaClient();

export const buildServer = async () => {
  const server = Fastify({
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await server.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:5173"];
  await server.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  await server.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await server.register(cookie);

  await server.register(jwt, {
    secret: process.env.JWT_SECRET || "supersecret_change_in_production",
    cookie: {
      cookieName: "accessToken",
      signed: false,
    },
  });

  server.decorate("prisma", prisma);

  server.register(authRoutes, { prefix: "/api/v1/auth" });
  server.register(kycRoutes, { prefix: "/api/v1/kyc" });

  return server;
};

const start = async () => {
  try {
    const server = await buildServer();
    const port = parseInt(process.env.PORT || "3001", 10);
    await server.listen({ port, host: "0.0.0.0" });
    logger.info(`Identity Service listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
