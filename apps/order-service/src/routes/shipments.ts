/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { PrismaClient } from '@tech-vibe/database';

const prisma = new PrismaClient();

const shipmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/:id/tracking', {
    schema: {
      params: Type.Object({
        id: Type.String()
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const userId = (request as any).user?.id; // Assuming auth sets user id

    const order = await prisma.order.findUnique({
      where: { id: BigInt(id) },
      include: {
        shipment: true
      }
    });

    if (!order) {
      return fastify.httpErrors.notFound('Order not found');
    }

    if (userId && order.userId !== BigInt(userId)) {
      return fastify.httpErrors.forbidden('Cannot access this order tracking');
    }

    if (!order.shipment) {
      return {
        data: null,
        message: 'No shipment info available yet'
      };
    }

    return {
      data: {
        orderId: order.id.toString(),
        courierName: order.shipment.courierName,
        trackingNumber: order.shipment.trackingNumber,
        shippingStatus: order.shipment.shippingStatus,
        timeline: order.shipment.timelineJson || [],
        updatedAt: order.shipment.updatedAt
      }
    };
  });

  fastify.patch('/admin/orders/:id/shipment', {
    preHandler: fastify.verifyAdmin,
    schema: {
      params: Type.Object({
        id: Type.String()
      }),
      body: Type.Object({
        courierName: Type.Optional(Type.String()),
        trackingNumber: Type.Optional(Type.String()),
        shippingStatus: Type.Optional(Type.Union([
          Type.Literal('packing'),
          Type.Literal('picked_up'),
          Type.Literal('in_transit'),
          Type.Literal('delivered'),
          Type.Literal('returned')
        ])),
        timelineEntry: Type.Optional(Type.Object({
          timestamp: Type.String(),
          location: Type.String(),
          description: Type.String()
        }))
      })
    }
  }, async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const order = await prisma.order.findUnique({
      where: { id: BigInt(id) },
      include: { shipment: true }
    });

    if (!order) {
      return fastify.httpErrors.notFound('Order not found');
    }

    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      let shipment = order.shipment;
      const timelineArr: any[] = Array.isArray(shipment?.timelineJson) 
        ? (shipment?.timelineJson as any[]) 
        : [];

      if (body.timelineEntry) {
        timelineArr.push(body.timelineEntry);
      }

      let currentShipment;
      if (shipment) {
        currentShipment = await tx.orderShipment.update({
          where: { orderId: BigInt(id) },
          data: {
            courierName: body.courierName !== undefined ? body.courierName : shipment.courierName,
            trackingNumber: body.trackingNumber !== undefined ? body.trackingNumber : shipment.trackingNumber,
            shippingStatus: body.shippingStatus !== undefined ? body.shippingStatus : shipment.shippingStatus,
            timelineJson: timelineArr
          }
        });
      } else {
        currentShipment = await tx.orderShipment.create({
          data: {
            orderId: BigInt(id),
            courierName: body.courierName || 'TBD',
            trackingNumber: body.trackingNumber,
            shippingStatus: body.shippingStatus || 'packing',
            timelineJson: timelineArr
          }
        });
      }

      let newOrderStatus = order.status;
      if (currentShipment.shippingStatus === 'in_transit') {
        newOrderStatus = 'shipped';
      } else if (currentShipment.shippingStatus === 'delivered') {
        newOrderStatus = 'completed'; // mapped 'delivered' to 'completed' as per OrderStatus enum
      }

      const updatedOrd = await tx.order.update({
        where: { id: BigInt(id) },
        data: {
          status: newOrderStatus
        },
        include: { shipment: true }
      });

      return updatedOrd;
    });

    return {
      data: {
        orderId: updatedOrder.id.toString(),
        orderStatus: updatedOrder.status,
        shipment: {
          courierName: updatedOrder.shipment?.courierName,
          trackingNumber: updatedOrder.shipment?.trackingNumber,
          shippingStatus: updatedOrder.shipment?.shippingStatus,
          timeline: updatedOrder.shipment?.timelineJson
        }
      }
    };
  });
};

export default shipmentRoutes;
