import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { OrderModule } from './order/order.module';
import { BlockchainModule } from './blockchain/blockchain.module';

@Module({
  imports: [
    ConfigModule,
    BlockchainModule,
    HealthModule,
    OrderModule,
  ],
})
export class AppModule {}
