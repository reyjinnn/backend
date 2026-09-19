import { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { PrismaClient } from "@tech-vibe/database";
import { logger } from "@tech-vibe/logger";

const prisma = new PrismaClient();

export const kycRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.addHook("onRequest", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  fastify.post(
    "/submit",
    {
      schema: {
        body: Type.Object({
          nik: Type.String({ minLength: 16, maxLength: 16 }),
          address: Type.String(),
          ktpImageUr: Type.String(),
          selfieImageUr: Type.String(),
        }),
        response: {
          200: Type.Object({
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
      const { nik, address, ktpImageUr, selfieImageUr } = request.body;
      const { id } = request.user as { id: string };

      try {
        await prisma.userProfile.update({
          where: { userId: BigInt(id) },
          data: {
            nik,
            address,
            ktpImageUr,
            selfieImageUr,
            kycStatus: "pending",
          },
        });

        return reply.send({
          success: true,
          message: "KYC documents submitted successfully",
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
