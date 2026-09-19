import { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { PrismaClient } from "@tech-vibe/database";
import * as argon2 from "argon2";
import { logger } from "@tech-vibe/logger";

const prisma = new PrismaClient();

export const authRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post(
    "/register",
    {
      schema: {
        body: Type.Object({
          name: Type.String(),
          email: Type.String({ format: "email" }),
          phone: Type.String(),
          password: Type.String({ minLength: 8 }),
        }),
        response: {
          201: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
            data: Type.Object({
              id: Type.String(),
            }),
          }),
          400: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
          }),
          500: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { name, email, phone, password } = request.body;

      try {
        const passwordHash = await argon2.hash(password);

        const user = await prisma.user.create({
          data: {
            name,
            email,
            phone,
            password_hash: passwordHash,
            role: "customer",
            status: "active",
          },
        });

        await prisma.userProfile.create({
          data: {
            userId: user.id,
            kycStatus: "unverified",
          },
        });

        return reply.code(201).send({
          success: true,
          message: "User registered successfully",
          data: {
            id: user.id.toString(),
          },
        });
      } catch (error: any) {
        logger.error(error);
        if (error.code === "P2002") {
          return reply
            .code(400)
            .send({ success: false, message: "Email or phone already exists" });
        }
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    },
  );

  fastify.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: Type.Object({
          email: Type.String({ format: "email" }),
          password: Type.String(),
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
            data: Type.Object({
              id: Type.String(),
              role: Type.String(),
            }),
          }),
          401: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
          }),
          429: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
          }),
          500: Type.Object({
            success: Type.Boolean(),
            message: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      try {
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !(await argon2.verify(user.password_hash, password))) {
          return reply
            .code(401)
            .send({ success: false, message: "Invalid credentials" });
        }

        const payload = { id: user.id.toString(), role: user.role };

        const accessToken = fastify.jwt.sign(payload, { expiresIn: "15m" });
        const refreshToken = fastify.jwt.sign(payload, { expiresIn: "7d" });

        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict" as const,
          path: "/",
        };

        reply.setCookie("accessToken", accessToken, {
          ...cookieOptions,
          maxAge: 15 * 60,
        });
        reply.setCookie("refreshToken", refreshToken, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60,
        });

        return reply.send({
          success: true,
          message: "Login successful",
          data: {
            id: user.id.toString(),
            role: user.role,
          },
        });
      } catch (error) {
        logger.error(error);
        return reply
          .code(500)
          .send({ success: false, message: "Internal server error" });
      }
    },
  );
};
