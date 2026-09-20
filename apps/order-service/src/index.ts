/**
 * Tech Vibe Core Engine
 * © 2026 @reyjinnn
 * This project is exclusively owned by @reyjinnn.
 */
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { logger } from '@tech-vibe/logger';
import authPlugin from './plugins/auth';
import cartRoutes from './routes/cart';
import checkoutRoutes from './routes/checkout';
import promoRoutes from './routes/promos';
import shipmentRoutes from './routes/shipments';
const buildServer = async () => {
  const fastify = Fastify({
    logger: false, // Custom logger used
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(sensible);
  await fastify.register(authPlugin);

  await fastify.register(cartRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(promoRoutes);
  await fastify.register(shipmentRoutes);

  return fastify;
};

const start = async () => {
  try {
    const server = await buildServer();
    const port = process.env.PORT_ORDER_SERVICE ? parseInt(process.env.PORT_ORDER_SERVICE, 10) : 3003;
    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`Order Service listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export default buildServer;
