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
      
      // Map contract errors to user-friendly messages
      // Known error signature 0xe58f9c95 (common revert)
      if (message.includes('0xe58f9c95')) {
        throw new BadRequestException('Unable to process your order. Please refresh and try again.');
      }
      if (message.includes('SignatureExpired')) {
        throw new BadRequestException('Your order session has expired. Please try again.');
      }
      if (message.includes('InvalidSignature')) {
        throw new BadRequestException('Order verification failed. Please try again.');
      }
      if (message.includes('ServiceNonceUsed')) {
        throw new BadRequestException('This order was already processed. Please refresh and try again.');
      }
      if (message.includes('UserNotRegistered')) {
        throw new BadRequestException('Please register your account before ordering.');
      }
      if (message.includes('ShopNotRegistered')) {
        throw new BadRequestException('The coffee shop is currently unavailable. Please try again later.');
      }
      if (message.includes('InsufficientBalance')) {
        throw new BadRequestException('Insufficient balance. Please add more funds to your account.');
      }
      if (message.includes('InvalidQuantity')) {
        throw new BadRequestException('Please select a valid quantity.');
      }
      if (message.includes('InvalidCoffeeType')) {
        throw new BadRequestException('Please select a valid coffee type.');
      }
      // Generic contract revert
      if (message.includes('reverted') || message.includes('revert')) {
        throw new BadRequestException('Unable to process your order. Please try again later.');
      }

      // Default user-friendly error
      throw new BadRequestException('Something went wrong. Please try again.');
    }
  }
}
