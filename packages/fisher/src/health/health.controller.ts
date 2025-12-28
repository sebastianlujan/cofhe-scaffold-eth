import { Controller, Get } from '@nestjs/common';
import { formatEther } from 'viem';
import { ConfigService } from '../config/config.service';
import { BlockchainService } from '../blockchain/blockchain.service';

interface HealthResponse {
  status: string;
  timestamp: string;
  fisher: {
    address: string;
    balance: string;
    configured: boolean;
  };
  contract: {
    address: string;
    chainId: number;
    shopRegistered: boolean;
  };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const balance = await this.blockchain.getBalance();
    const shopRegistered = await this.blockchain.isShopRegistered();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      fisher: {
        address: this.blockchain.fisherAddress,
        balance: `${formatEther(balance)} ETH`,
        configured: true,
      },
      contract: {
        address: this.config.evvmCafeGaslessAddress,
        chainId: this.config.chainId,
        shopRegistered,
      },
    };
  }
}
