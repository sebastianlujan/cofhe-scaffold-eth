import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import * as net from 'net';

const logger = new Logger('Fisher');

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the preferred port
 */
async function findAvailablePort(preferredPort: number, maxAttempts = 10): Promise<number> {
  // Ensure preferredPort is a number
  const basePort = Number(preferredPort);
  
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
    logger.warn(`Port ${port} is in use, trying ${port + 1}...`);
  }
  throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${basePort}`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Enable CORS for frontend
  app.enableCors();

  // Find available port
  const preferredPort = config.port;
  const actualPort = await findAvailablePort(preferredPort);

  if (actualPort !== preferredPort) {
    logger.warn(`Preferred port ${preferredPort} was in use, using port ${actualPort} instead`);
  }

  await app.listen(actualPort);

  logger.log('='.repeat(50));
  logger.log('EVVM Fisher Relayer');
  logger.log('='.repeat(50));
  logger.log(`Server running on port ${actualPort}`);
  logger.log(`Chain ID: ${config.chainId} (Sepolia)`);
  logger.log(`Contract: ${config.evvmCafeGaslessAddress}`);
  logger.log('='.repeat(50));
  logger.log('Endpoints:');
  logger.log(`  GET  http://localhost:${actualPort}/health`);
  logger.log(`  POST http://localhost:${actualPort}/order`);
  logger.log('='.repeat(50));

  // Store actual port for status checks
  process.env.FISHER_ACTUAL_PORT = String(actualPort);
}

bootstrap().catch((err) => {
  logger.error('Failed to start Fisher relayer:', err.message);
  process.exit(1);
});
