import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ConfigService } from '../config/config.service';
import { EVVMCafeGaslessABI } from '../contracts/evvm-cafe-gasless.abi';
import { CreateOrderDto } from '../order/dto/create-order.dto';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: PrivateKeyAccount;

  constructor(private readonly config: ConfigService) {
    this.account = privateKeyToAccount(config.privateKey as Hex);

    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport: http(config.rpcUrl),
    });
  }

  async onModuleInit() {
    this.logger.log(`Fisher wallet: ${this.account.address}`);
    const balance = await this.getBalance();
    this.logger.log(`Fisher balance: ${formatEther(balance)} ETH`);
  }

  get fisherAddress(): string {
    return this.account.address;
  }

  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({
      address: this.account.address,
    });
  }

  async executeOrder(dto: CreateOrderDto): Promise<Hex> {
    this.logger.log(`Executing order for client: ${dto.client}`);
    this.logger.log(`  Coffee: ${dto.coffeeType} x${dto.quantity}`);
    this.logger.log(`  Priority Fee: ${dto.priorityFee}`);

    // EIP-191: contract takes individual parameters, not a struct
    const hash = await this.walletClient.writeContract({
      chain: sepolia,
      account: this.account,
      address: this.config.evvmCafeGaslessAddress as Hex,
      abi: EVVMCafeGaslessABI,
      functionName: 'orderCoffeeGasless',
      args: [
        dto.client as Hex,                    // client
        dto.coffeeType,                       // coffeeType
        BigInt(dto.quantity),                 // quantity
        BigInt(dto.serviceNonce),             // serviceNonce
        dto.amountCommitment as Hex,          // amountCommitment
        BigInt(dto.evvmNonce),                // evvmNonce
        BigInt(dto.deadline),                 // deadline
        BigInt(dto.priorityFee),              // priorityFee
        dto.encryptedAmount as Hex,           // encryptedAmount
        dto.inputProof as Hex,                // inputProof
        dto.signature as Hex,                 // signature
      ],
    });

    this.logger.log(`Transaction submitted: ${hash}`);
    return hash;
  }

  async waitForReceipt(hash: Hex): Promise<TransactionReceipt> {
    this.logger.log(`Waiting for confirmation: ${hash}`);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    this.logger.log(`Confirmed in block ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);
    return receipt;
  }

  async isShopRegistered(): Promise<boolean> {
    try {
      const result = await this.publicClient.readContract({
        address: this.config.evvmCafeGaslessAddress as Hex,
        abi: EVVMCafeGaslessABI,
        functionName: 'isShopRegistered',
      });
      return result as boolean;
    } catch {
      return false;
    }
  }
}
