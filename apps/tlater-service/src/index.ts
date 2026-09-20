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
import tlaterRoutes from './routes/tlater';
import { initLateFeeCron } from './workers/late-fee-cron';

const buildServer = async () => {
  const fastify = Fastify({
    logger: false, // We'll use our custom logger or disable default to keep logs clean
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(sensible);
  await fastify.register(authPlugin);

  await fastify.register(tlaterRoutes);

  return fastify;
};

const start = async () => {
  try {
    const server = await buildServer();
    const port = process.env.PORT_TLATER_SERVICE ? parseInt(process.env.PORT_TLATER_SERVICE, 10) : 3005;
    
    initLateFeeCron();
    logger.info('Late fee cron job initialized');

    await server.listen({ port, host: '0.0.0.0' });
    logger.info(`TLater Service listening on port ${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

export default buildServer;
