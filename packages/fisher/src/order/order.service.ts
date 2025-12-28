import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly blockchain: BlockchainService) {}

  async executeGaslessOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    this.logger.log(`Processing gasless order`);
    this.logger.log(`  Client: ${dto.client}`);
    this.logger.log(`  Coffee: ${dto.coffeeType} x${dto.quantity}`);
    this.logger.log(`  Priority Fee: ${dto.priorityFee}`);
    this.logger.log(`  Deadline: ${dto.deadline}`);

    try {
      // Execute transaction (contract handles all validation)
      const txHash = await this.blockchain.executeOrder(dto);

      // Wait for confirmation
      const receipt = await this.blockchain.waitForReceipt(txHash);

      if (receipt.status === 'reverted') {
        throw new BadRequestException('Transaction reverted');
      }

      this.logger.log(`Order completed successfully`);
      this.logger.log(`  TX Hash: ${txHash}`);
      this.logger.log(`  Block: ${receipt.blockNumber}`);
      this.logger.log(`  Gas Used: ${receipt.gasUsed}`);

      return {
        success: true,
        transactionHash: txHash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      this.logger.error(`Order failed: ${error}`);
      
      // Extract revert reason if available
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // Map common contract errors to user-friendly messages
      if (message.includes('SignatureExpired')) {
        throw new BadRequestException('Signature has expired');
      }
      if (message.includes('InvalidSignature')) {
        throw new BadRequestException('Invalid signature');
      }
      if (message.includes('ServiceNonceUsed')) {
        throw new BadRequestException('Service nonce already used');
      }
      if (message.includes('UserNotRegistered')) {
        throw new BadRequestException('User not registered in EVVM');
      }
      if (message.includes('ShopNotRegistered')) {
        throw new BadRequestException('Shop not registered in EVVM');
      }
      if (message.includes('InsufficientBalance')) {
        throw new BadRequestException('Insufficient balance for payment');
      }
      if (message.includes('InvalidQuantity')) {
        throw new BadRequestException('Invalid quantity');
      }
      if (message.includes('InvalidCoffeeType')) {
        throw new BadRequestException('Invalid coffee type');
      }

      throw new BadRequestException(`Transaction failed: ${message}`);
    }
  }
}
