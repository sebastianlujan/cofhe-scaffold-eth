export class OrderResponseDto {
  success: boolean;
  transactionHash: string;
  blockNumber: string;
  gasUsed: string;
}

export class OrderErrorDto {
  success: boolean;
  error: string;
}
