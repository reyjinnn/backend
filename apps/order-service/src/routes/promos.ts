import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const promoRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply Promo
  fastify.post('/promos/apply', {
    preHandler: (fastify as any).verifyAuth,
    schema: {
      body: Type.Object({
        code: Type.String(),
        subtotal: Type.Number({ minimum: 0 })
      })
    }
  }, async (request, reply) => {
    const { code, subtotal } = request.body as any;

    const promo = await prisma.promo.findUnique({
      where: { code }
    });

    if (!promo) {
      return reply.badRequest('Promo code not found');
    }

    if (promo.status !== 'active') {
      return reply.badRequest('Promo code is not active');
    }

    const now = new Date();
    if (now < promo.startDate || now > promo.endDate) {
      return reply.badRequest('Promo code is not within the valid date window');
    }

    if (promo.quota !== null && (promo.quota - promo.usedCount) <= 0) {
      return reply.badRequest('Promo code quota has been reached');
    }

    if (subtotal < Number(promo.minPurchase)) {
      return reply.badRequest(`Minimum purchase of ${promo.minPurchase} is required`);
    }

    let discountAmount = 0;
    const promoValue = Number(promo.value);

    if (promo.valueType === 'persen') {
      discountAmount = (subtotal * promoValue) / 100;
      if (promo.maxDiscount && discountAmount > Number(promo.maxDiscount)) {
        discountAmount = Number(promo.maxDiscount);
      }
    } else if (promo.valueType === 'nominal') {
      discountAmount = promoValue;
    } else if (promo.valueType === 'poin') {
      // Diskon otomatis cashback poin, tidak potong subtotal di sini
      discountAmount = 0; 
    }

    // Prevent discount > subtotal
    if (discountAmount > subtotal) {
      discountAmount = subtotal;
    }

    return {
      valid: true,
      promoId: promo.id.toString(),
      code: promo.code,
      discountAmount,
      payableSubtotal: subtotal - discountAmount
    };
  });

  // Get Active Promos
  fastify.get('/promos/active', async (request, reply) => {
    const now = new Date();
    const promos = await prisma.promo.findMany({
      where: {
        status: 'active',
        startDate: { lte: now },
        endDate: { gte: now }
      }
    });

    // Filter by quota manually if needed, but we can return all active
    const activePromos = promos.filter((p: any) => p.quota === null || p.quota > p.usedCount);

    return { promos: activePromos };
  });

  // Create Promo (Admin)
  fastify.post('/admin/promos', {
    preHandler: [(fastify as any).verifyAuth, (fastify as any).verifyRole?.(['admin', 'superadmin'])].filter(Boolean),
    schema: {
      body: Type.Object({
        name: Type.String(),
        description: Type.Optional(Type.String()),
        code: Type.Optional(Type.String()),
        type: Type.String(), // 'flash_sale', 'voucher', 'diskon_otomatis'
        valueType: Type.String(), // 'persen', 'nominal', 'poin'
        value: Type.Number(),
        maxDiscount: Type.Optional(Type.Number()),
        startDate: Type.String({ format: 'date-time' }),
        endDate: Type.String({ format: 'date-time' }),
        minPurchase: Type.Optional(Type.Number()),
        quota: Type.Optional(Type.Number()),
        maxPerUser: Type.Optional(Type.Number()),
        targetType: Type.Optional(Type.String()),
        audienceType: Type.Optional(Type.String()),
      })
    }
  }, async (request, reply) => {
    const data = request.body as any;

    const promo = await prisma.promo.create({
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      }
    });

    return { success: true, promoId: promo.id.toString() };
  });
};

export default promoRoutes;
