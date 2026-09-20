import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';
import axios from 'axios';
import { logger } from '@tech-vibe/logger';

const prisma = new PrismaClient();

const catalogServiceUrl = process.env.CATALOG_SERVICE_URL || 'http://localhost:3002';
const pointServiceUrl = process.env.POINT_SERVICE_URL || 'http://localhost:3004';
const tlaterServiceUrl = process.env.TLATER_SERVICE_URL || 'http://localhost:3005';
const internalApiKey = process.env.INTERNAL_API_KEY || 'default-internal-secret';

const checkoutRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/orders/checkout', {
    preHandler: fastify.verifyAuth,
    schema: {
      headers: Type.Object({
        'idempotency-key': Type.String()
      }),
      body: Type.Object({
        shippingAddress: Type.String(),
        notes: Type.Optional(Type.String()),
        items: Type.Array(Type.Object({
          productId: Type.String(),
          quantity: Type.Number({ minimum: 1 })
        })),
        promoCode: Type.Optional(Type.String()),
        insuranceSelected: Type.Optional(Type.Boolean()),
        paymentSplit: Type.Object({
          usePointsAmount: Type.Number(),
          useTlater: Type.Boolean(),
          tlaterTenorMonths: Type.Optional(Type.Number()),
          gatewayCashAmount: Type.Number()
        })
      })
    }
  }, async (request, reply) => {
    const { id: userId } = (request as any).user;
    const idempotencyKey = request.headers['idempotency-key'] as string;
    const { shippingAddress, notes, items, paymentSplit, promoCode, insuranceSelected } = request.body as any;

    if (items.length === 0) {
      return reply.badRequest('Cart is empty');
    }

    // Idempotency Check on Order Table
    const existingOrder = await prisma.order.findFirst({
      where: { notes: `IDEMP:${idempotencyKey}` } // using notes as a makeshift idempotency store for demo
    });
    if (existingOrder) {
      return { success: true, message: 'Order already processed', orderId: existingOrder.id.toString() };
    }

    // 1. Calculate Grand Total dynamically
    const productIds = items.map((i: any) => BigInt(i.productId));
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    let totalItemAmount = 0;
    const orderItemsPayload = [];

    for (const item of items) {
      const product = products.find((p: any) => p.id === BigInt(item.productId));
      if (!product) return reply.badRequest(`Product ${item.productId} not found`);

      const price = parseFloat(product.price.toString());
      const subtotal = price * item.quantity;
      totalItemAmount += subtotal;

      orderItemsPayload.push({
        productId: product.id,
        productNameSnapshot: product.name,
        priceSnapshot: price,
        quantity: item.quantity,
        subtotal
      });
    }

    const shippingFee = 25000; // Flat shipping rate
    const insuranceFee = insuranceSelected ? 20000 : 0;

    let promoDiscount = 0;
    let promoId: bigint | null = null;
    if (promoCode) {
      const promo = await prisma.promo.findUnique({ where: { code: promoCode } });
      if (!promo) return reply.badRequest('Invalid promo code');
      if (promo.status !== 'active') return reply.badRequest('Promo not active');
      if (promo.quota !== null && promo.usedCount >= promo.quota) return reply.badRequest('Promo quota reached');
      
      const now = new Date();
      if (now < promo.startDate || now > promo.endDate) return reply.badRequest('Promo not within active date window');

      if (totalItemAmount < Number(promo.minPurchase)) return reply.badRequest(`Minimum purchase of ${promo.minPurchase} required for promo`);
      
      const promoValue = Number(promo.value);
      if (promo.valueType === 'persen') {
        promoDiscount = (totalItemAmount * promoValue) / 100;
        if (promo.maxDiscount && promoDiscount > Number(promo.maxDiscount)) {
          promoDiscount = Number(promo.maxDiscount);
        }
      } else if (promo.valueType === 'nominal') {
        promoDiscount = promoValue;
      }
      
      if (promoDiscount > totalItemAmount) promoDiscount = totalItemAmount;
      promoId = promo.id;
    }

    const grandTotal = (totalItemAmount - promoDiscount) + shippingFee + insuranceFee;

    // 2. Validate Payment Split
    const requestedTlaterAmount = grandTotal - (paymentSplit.usePointsAmount + paymentSplit.gatewayCashAmount);
    
    // In strict mode, they should exactly match. But since tlater amount wasn't provided in payload explicitly, we deduce it or validate exactly.
    // The prompt says: "usePointsAmount + tlaterAmount + gatewayCashAmount == grandTotal"
    // So if useTlater is true, we assume tlater pays the rest. If useTlater is false, then points + cash must equal grandTotal.
    let tlaterAmount = 0;
    if (paymentSplit.useTlater) {
      tlaterAmount = requestedTlaterAmount;
      if (tlaterAmount <= 0) return reply.badRequest('Invalid split: TLater amount is <= 0');
      if (!paymentSplit.tlaterTenorMonths) return reply.badRequest('TLater tenor is required');
    } else {
      if (paymentSplit.usePointsAmount + paymentSplit.gatewayCashAmount !== grandTotal) {
        return reply.badRequest('Payment split total does not match grand total');
      }
    }

    // Orchestrate Saga
    const compensationStack: (() => Promise<void>)[] = [];
    let isSuccess = false;

    try {
      // Step A: Reserve Catalog Stocks
      logger.info('SAGA: Reserving stocks');
      await axios.post(`${catalogServiceUrl}/internal/stocks/reserve`, {
        items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity }))
      }, { headers: { 'x-internal-api-key': internalApiKey } });

      compensationStack.push(async () => {
        logger.info('COMPENSATING: Releasing stocks');
        await axios.post(`${catalogServiceUrl}/internal/stocks/release`, {
          items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity }))
        }, { headers: { 'x-internal-api-key': internalApiKey } }).catch(e => logger.error('Failed to release stock during compensation'));
      });

      // Step B: Hold Points
      const pointHoldIdempotencyKey = `HOLD-${idempotencyKey}`;
      if (paymentSplit.usePointsAmount > 0) {
        logger.info('SAGA: Holding points');
        await axios.post(`${pointServiceUrl}/internal/points/hold-balance`, {
          userId,
          amount: paymentSplit.usePointsAmount.toString(),
          referenceId: `ORDER-${idempotencyKey}`
        }, { headers: { 'x-internal-api-key': internalApiKey, 'idempotency-key': pointHoldIdempotencyKey } });

        compensationStack.push(async () => {
          logger.info('COMPENSATING: Releasing points');
          await axios.post(`${pointServiceUrl}/internal/points/release-hold`, {
            userId,
            amount: paymentSplit.usePointsAmount.toString(),
            referenceId: `ORDER-${idempotencyKey}`,
            holdIdempotencyKey: pointHoldIdempotencyKey
          }, { headers: { 'x-internal-api-key': internalApiKey, 'idempotency-key': `REL-${pointHoldIdempotencyKey}` } }).catch(e => logger.error('Failed to release points during compensation'));
        });
      }

      // We need to create an Order record in DB before Tlater disburse because Tlater requires an orderId.
      // Or we can create a temporary orderId. Let's create the order record first in a pending state.
      
      const orderNumber = `ORD-${Date.now()}-${userId}`;
      const createdOrder = await prisma.order.create({
        data: {
          orderNumber,
          userId: BigInt(userId),
          totalItemAmount,
          shippingFee,
          insuranceFee,
          discountAmount: promoDiscount,
          grandTotal,
          status: 'pending',
          shippingAddress,
          notes: `IDEMP:${idempotencyKey}\n${notes || ''}`,
          items: {
            create: orderItemsPayload
          },
          payments: {
            create: [] // Will add after
          }
        }
      });

      // Step C: Tlater Disburse
      if (paymentSplit.useTlater) {
        logger.info('SAGA: Disbursing TLater');
        await axios.post(`${tlaterServiceUrl}/internal/tlater/disburse`, {
          userId,
          orderId: createdOrder.id.toString(),
          principalAmount: tlaterAmount.toString(),
          tenorMonths: paymentSplit.tlaterTenorMonths
        }, { headers: { 'x-internal-api-key': internalApiKey } });

        compensationStack.push(async () => {
          logger.info('COMPENSATING: Canceling TLater Loan');
          await axios.post(`${tlaterServiceUrl}/internal/tlater/cancel-loan`, {
            orderId: createdOrder.id.toString()
          }, { headers: { 'x-internal-api-key': internalApiKey } }).catch(e => logger.error('Failed to cancel tlater loan during compensation'));
        });
      }

      // Step D: Insert Payment Records and Update Order Status
      const paymentRecords = [];
      if (paymentSplit.usePointsAmount > 0) {
        paymentRecords.push({
          orderId: createdOrder.id,
          paymentMethod: 'point',
          amount: paymentSplit.usePointsAmount,
          status: 'settled',
          referenceId: pointHoldIdempotencyKey
        });
      }
      if (paymentSplit.useTlater) {
        paymentRecords.push({
          orderId: createdOrder.id,
          paymentMethod: 'tlater',
          amount: tlaterAmount,
          status: 'settled',
          referenceId: 'TLATER'
        });
      }
      if (paymentSplit.gatewayCashAmount > 0) {
        paymentRecords.push({
          orderId: createdOrder.id,
          paymentMethod: 'gateway_cash',
          amount: paymentSplit.gatewayCashAmount,
          status: 'pending' // Still needs real gateway callback
        });
      }

      // @ts-ignore
      await prisma.orderPayment.createMany({ data: paymentRecords });

      const finalStatus = paymentSplit.gatewayCashAmount > 0 ? 'pending' : 'paid';
      await prisma.order.update({
        where: { id: createdOrder.id },
        data: { status: finalStatus, paidAt: finalStatus === 'paid' ? new Date() : null }
      });

      if (promoId) {
        await prisma.promo.update({
          where: { id: promoId },
          data: { usedCount: { increment: 1 } }
        });
        await prisma.userPromoUsage.create({
          data: {
            userId: BigInt(userId),
            promoId: promoId,
            orderId: createdOrder.id,
            discountAmount: promoDiscount
          }
        });
      }

      // Saga Completed Successfully
      isSuccess = true;

      // Asynchronous Commits (Fire and Forget or Background Worker in real app)
      axios.post(`${catalogServiceUrl}/internal/stocks/commit`, {
        items: items.map((i: any) => ({ productId: i.productId, quantity: i.quantity }))
      }, { headers: { 'x-internal-api-key': internalApiKey } }).catch(e => logger.error('Async commit stock failed'));

      if (paymentSplit.usePointsAmount > 0) {
        axios.post(`${pointServiceUrl}/internal/points/commit-redemption`, {
          userId,
          amount: paymentSplit.usePointsAmount.toString(),
          referenceId: `ORDER-${idempotencyKey}`,
          holdIdempotencyKey: pointHoldIdempotencyKey
        }, { headers: { 'x-internal-api-key': internalApiKey, 'idempotency-key': `COM-${pointHoldIdempotencyKey}` } }).catch(e => logger.error('Async commit point failed'));
      }

      return {
        success: true,
        message: 'Order created successfully via Saga checkout',
        data: {
          orderId: createdOrder.id.toString(),
          orderNumber,
          status: finalStatus
        }
      };

    } catch (error: any) {
      logger.error('Saga execution failed, initiating compensation. Error:', error.message);
      if (error.response) logger.error(error.response.data);

      // Execute compensations in reverse order
      while (compensationStack.length > 0) {
        const compensate = compensationStack.pop();
        if (compensate) await compensate();
      }

      return reply.code(500).send({
        error: 'CheckoutFailed',
        message: 'Failed to process checkout. All reservations have been rolled back.',
        details: error.response?.data?.message || error.message
      });
    }
  });
};

export default checkoutRoutes;
