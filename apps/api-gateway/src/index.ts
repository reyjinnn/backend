import Fastify from "fastify";
import proxy from "@fastify/http-proxy";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { logger } from "@tech-vibe/logger";

const buildServer = async () => {
  const server = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
  });

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

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/identity",
    rewritePrefix: "/api/v1",
  });

  await server.register(proxy, {
    upstream: process.env.CATALOG_SERVICE_URL || "http://localhost:3002",
    prefix: "/api/v1/catalog",
    rewritePrefix: "/api/v1",
  });

  server.get("/health", async () => {
    return { status: "ok", service: "api-gateway" };
  });

  return server;
};

const start = async () => {
  try {
    const server = await buildServer();
    const port = parseInt(process.env.PORT || "3000", 10);
    await server.listen({ port, host: "0.0.0.0" });
    logger.info(`API Gateway listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
