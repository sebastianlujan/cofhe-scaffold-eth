import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  controllers: [HealthController],
})
export class HealthModule {}
