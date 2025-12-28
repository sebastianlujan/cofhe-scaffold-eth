import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [BlockchainModule, ConfigModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
