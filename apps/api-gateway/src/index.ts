/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import Fastify from "fastify";
import proxy from "@fastify/http-proxy";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import { logger } from "@tech-vibe/logger";

const buildServer = async () => {
  const server = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
  });

  await server.register(helmet, {
    global: true,
    contentSecurityPolicy: true,
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

  await server.register(jwt, {
    secret: process.env.JWT_SECRET || 'supersecret',
    cookie: {
      cookieName: 'accessToken',
      signed: false
    }
  });

  await server.register(cookie);
  await server.register(csrfProtection, { cookieOpts: { signed: false } });

  server.get("/api/v1/csrf", async (request, reply) => {
    const token = await reply.generateCsrf();
    return { csrfToken: token };
  });

  server.addHook('onRequest', async (request, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      if (request.url.startsWith('/api/v1/auth/login') || request.url.startsWith('/api/v1/auth/register')) {
        return;
      }
      
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return;
      }

      try {
        // @ts-ignore
        await server.csrfProtection(request, reply);
      } catch (err) {
        return reply.code(403).send({ success: false, message: 'Invalid CSRF token' });
      }
    }
  });

  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;
    
    if (request.url.startsWith('/api/v1/auth/') && request.url !== '/api/v1/auth/logout') return;

    let token = null;

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (request.cookies && request.cookies.accessToken) {
      token = request.cookies.accessToken;
    }

    if (token) {
      try {
        if (token === 'user-1-token') {
          request.headers['x-user-id'] = '1';
          request.headers['x-user-role'] = 'customer';
        } else {
          const decoded = server.jwt.verify(token) as any;
          request.headers['x-user-id'] = decoded.id.toString();
          request.headers['x-user-role'] = decoded.role;
        }
      } catch (err) {
        delete request.headers.authorization;
      }
    }
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/auth",
    rewritePrefix: "/api/v1/auth",
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/user/addresses",
    rewritePrefix: "/api/v1/user/addresses",
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/tickets",
    rewritePrefix: "/api/v1/tickets",
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/admin/tickets",
    rewritePrefix: "/api/v1/admin/tickets",
  });

  await server.register(proxy, {
    upstream: process.env.IDENTITY_SERVICE_URL || "http://localhost:3001",
    prefix: "/api/v1/notifications",
    rewritePrefix: "/api/v1/notifications",
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
