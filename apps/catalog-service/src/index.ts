import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { logger } from '@tech-vibe/logger';
import authPlugin from './plugins/auth';
import catalogRoutes from './routes/catalog';
import internalStocksRoutes from './routes/internal-stocks';

const buildServer = async () => {
  const fastify = Fastify({
    logger: false, // We'll use our custom logger or disable default to keep logs clean
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Register plugins
  await fastify.register(sensible);
  await fastify.register(authPlugin);

  // Register routes
  await fastify.register(catalogRoutes);
  await fastify.register(internalStocksRoutes);

  return fastify;
};

const start = async () => {
  try {
    const server = await buildServer();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`Catalog Service listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export default buildServer;
