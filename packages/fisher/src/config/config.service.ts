import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: NestConfigService) {}

  get chainId(): number {
    return this.configService.get<number>('CHAIN_ID', 11155111);
  }

  get rpcUrl(): string {
    const url = this.configService.get<string>('RPC_URL');
    if (!url) {
      throw new Error('RPC_URL environment variable is required');
    }
    return url;
  }

  get privateKey(): string {
    const key = this.configService.get<string>('FISHER_PRIVATE_KEY');
    if (!key) {
      throw new Error('FISHER_PRIVATE_KEY environment variable is required');
    }
    return key.startsWith('0x') ? key : `0x${key}`;
  }

  get evvmCafeGaslessAddress(): string {
    const address = this.configService.get<string>('EVVM_CAFE_GASLESS_ADDRESS');
    if (!address) {
      throw new Error('EVVM_CAFE_GASLESS_ADDRESS environment variable is required');
    }
    return address;
  }

  get port(): number {
    return this.configService.get<number>('PORT', 3001);
  }

  get minPriorityFee(): bigint {
    const fee = this.configService.get<string>('MIN_PRIORITY_FEE', '0');
    return BigInt(fee);
  }

  get minGasBalance(): bigint {
    const balance = this.configService.get<string>('MIN_GAS_BALANCE', '10000000000000000'); // 0.01 ETH
    return BigInt(balance);
  }
}
