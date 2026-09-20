import Fastify from "fastify";
import proxy from "@fastify/http-proxy";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
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

  // Simple JWT plugin for gateway
  await server.register(jwt, {
    secret: process.env.JWT_SECRET || 'supersecret'
  });

  // Verify JWT and inject headers for authenticated routes
  // We apply this dynamically based on route prefixes or just generally and skip if no auth header
  // However, the cleanest way in a gateway is to just check if authorization header exists, decode it, and pass headers.
  server.addHook('onRequest', async (request, reply) => {
    // Only process /api/v1 routes
    if (!request.url.startsWith('/api/v1/')) return;
    
    // Auth routes don't need token verification (login/register)
    if (request.url.startsWith('/api/v1/auth/')) return;

    // For other routes, if token exists, we decode it and append headers
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        // Mock verification for Sprint 2 matching other services
        const token = authHeader.split(' ')[1];
        if (token === 'user-1-token') {
          request.headers['x-user-id'] = '1';
          request.headers['x-user-role'] = 'customer';
        } else {
          // If a real token, we would use server.jwt.verify()
          const decoded = await request.jwtVerify() as any;
          request.headers['x-user-id'] = decoded.id.toString();
          request.headers['x-user-role'] = decoded.role;
        }
      } catch (err) {
        // If token is invalid, we strip it out so downstream knows it's unauthenticated
        delete request.headers.authorization;
      }
    }
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/auth",
    rewritePrefix: "/api/v1",
  });

  await server.register(proxy, {
    upstream: process.env.CATALOG_SERVICE_URL || "http://localhost:3002",
    prefix: "/api/v1/catalog",
    rewritePrefix: "",
  });

  await server.register(proxy, {
    upstream: process.env.ORDER_SERVICE_URL || "http://localhost:3003",
    prefix: "/api/v1/orders",
    rewritePrefix: "/orders",
  });

  await server.register(proxy, {
    upstream: process.env.ORDER_SERVICE_URL || "http://localhost:3003",
    prefix: "/api/v1/admin/orders",
    rewritePrefix: "/admin/orders",
  });

  await server.register(proxy, {
    upstream: process.env.ORDER_SERVICE_URL || "http://localhost:3003",
    prefix: "/api/v1/promos",
    rewritePrefix: "/promos",
  });

  await server.register(proxy, {
    upstream: process.env.ORDER_SERVICE_URL || "http://localhost:3003",
    prefix: "/api/v1/admin/promos",
    rewritePrefix: "/admin/promos",
  });

  await server.register(proxy, {
    upstream: process.env.POINT_SERVICE_URL || "http://localhost:3004",
    prefix: "/api/v1/points",
    rewritePrefix: "/api/v1",
  });

  await server.register(proxy, {
    upstream: process.env.TLATER_SERVICE_URL || "http://localhost:3005",
    prefix: "/api/v1/tlater",
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
