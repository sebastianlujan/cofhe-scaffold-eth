import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { type Hex } from 'viem';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../config/config.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import {
  validateOrder,
  buildOrderMessage,
  getTimeUntilDeadline,
} from '../utils/signature';
import {
  ValidationException,
  ValidationErrorCode,
  createValidationException,
  mapContractErrorToException,
  ServiceNonceUsedException,
} from './errors/validation.errors';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly config: ConfigService,
  ) {}

  async executeGaslessOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    this.logger.log(`Processing gasless order`);
    this.logger.log(`  Client: ${dto.client}`);
    this.logger.log(`  Coffee: ${dto.coffeeType} x${dto.quantity}`);
    this.logger.log(`  Priority Fee: ${dto.priorityFee}`);
    this.logger.log(`  Deadline: ${dto.deadline}`);

    // ============ Pre-Validation (saves gas on invalid orders) ============
    // This is the key feature - we validate BEFORE paying gas
    // If validation fails, we throw immediately and never submit the transaction
    await this.validateOrderBeforeSubmit(dto);

    try {
      // Execute transaction - only reached if validation passed
      this.logger.log('Validation passed, submitting to blockchain...');
      const txHash = await this.blockchain.executeOrder(dto);

      // Wait for confirmation
      const receipt = await this.blockchain.waitForReceipt(txHash);

      if (receipt.status === 'reverted') {
        // This should rarely happen since we pre-validate
        this.logger.error('Transaction reverted despite passing validation');
        throw new ValidationException(
          ValidationErrorCode.UNKNOWN_ERROR,
          'Transaction reverted unexpectedly. Please try again.',
        );
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
      // Extract error message
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Order failed: ${message}`);

      // Re-throw ValidationException as-is (from our validation)
      if (error instanceof ValidationException) {
        throw error;
      }

      // Re-throw BadRequestException as-is (legacy)
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Map contract errors to our custom exceptions
      // This handles cases where the contract rejects despite our validation
      // (e.g., race conditions, state changes between validation and execution)
      throw mapContractErrorToException(message);
    }
  }

  /**
   * Validates order BEFORE submitting to blockchain
   *
   * This is the core of the signature verification feature.
   * By validating off-chain first, we:
   * 1. Save gas - invalid orders never hit the blockchain
   * 2. Provide faster feedback - no need to wait for tx confirmation
   * 3. Give better error messages - we know exactly what failed
   *
   * Validation order (matches contract):
   * 1. Deadline not expired
   * 2. Amount commitment matches encrypted amount
   * 3. EIP-191 signature is valid
   * 4. Quantity > 0
   * 5. Priority fee >= minimum
   * 6. Service nonce not used (optional, requires contract call)
   *
   * @param dto - Order data from request
   * @throws ValidationException if any validation fails
   */
  private async validateOrderBeforeSubmit(dto: CreateOrderDto): Promise<void> {
    this.logger.log('=== Signature Validation Started ===');

    // Log deadline info for debugging
    const timeRemaining = getTimeUntilDeadline(BigInt(dto.deadline));
    this.logger.log(`  Time until deadline: ${timeRemaining}s`);

    if (timeRemaining <= 0) {
      this.logger.warn(`  REJECTED: Deadline already expired (${timeRemaining}s ago)`);
    }

    // Build params for validation
    const params = {
      client: dto.client,
      coffeeType: dto.coffeeType,
      quantity: dto.quantity,
      serviceNonce: dto.serviceNonce,
      amountCommitment: dto.amountCommitment,
      evvmNonce: dto.evvmNonce,
      deadline: dto.deadline,
      priorityFee: dto.priorityFee,
    };

    // Run validation (this checks signature, deadline, commitment, etc.)
    const result = await validateOrder(
      params,
      dto.signature as Hex,
      dto.encryptedAmount as Hex,
      this.config.minPriorityFee,
    );

    if (!result.valid) {
      this.logger.warn(`=== Signature Validation FAILED ===`);
      this.logger.warn(`  Error: ${result.error}`);
      this.logger.warn(`  Details: ${JSON.stringify(result.details, null, 2)}`);

      // Create specific exception based on what failed
      throw createValidationException(result.error!, {
        ...result.details,
        client: dto.client,
        deadline: dto.deadline,
        quantity: dto.quantity,
        fee: dto.priorityFee,
        minFee: this.config.minPriorityFee.toString(),
      });
    }

    // Optional: Check if service nonce is already used
    // This requires a contract read call (~100-200ms latency)
    // But prevents submitting orders that will definitely fail
    try {
      const isNonceUsed = await this.blockchain.isServiceNonceUsed(
        dto.client as Hex,
        BigInt(dto.serviceNonce),
      );

      if (isNonceUsed) {
        this.logger.warn(`=== Service Nonce Already Used ===`);
        this.logger.warn(`  Client: ${dto.client}`);
        this.logger.warn(`  Nonce: ${dto.serviceNonce}`);

        throw new ServiceNonceUsedException(dto.serviceNonce, {
          client: dto.client,
        });
      }
    } catch (error) {
      // If it's our exception, re-throw it
      if (error instanceof ValidationException) {
        throw error;
      }
      // Otherwise log warning but continue (let contract validate)
      // This handles cases where we can't reach the contract
      this.logger.warn(`Could not verify service nonce (will let contract validate): ${error}`);
    }

    // Log success
    const message = buildOrderMessage(params);
    this.logger.log(`=== Signature Validation PASSED ===`);
    this.logger.log(`  Message: ${message.substring(0, 60)}...`);
    this.logger.log(`  Signer: ${dto.client}`);
  }
}
