import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for EIP-191 gasless order submission
 * 
 * Message Format:
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 */
export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  client: string;

  @IsString()
  @IsNotEmpty()
  coffeeType: string;

  @IsString()
  @IsNotEmpty()
  quantity: string;

  @IsString()
  @IsNotEmpty()
  serviceNonce: string;

  @IsString()
  @IsNotEmpty()
  amountCommitment: string;

  @IsString()
  @IsNotEmpty()
  evvmNonce: string;

  @IsString()
  @IsNotEmpty()
  deadline: string;

  @IsString()
  @IsNotEmpty()
  priorityFee: string;

  @IsString()
  @IsNotEmpty()
  encryptedAmount: string;

  @IsString()
  @IsNotEmpty()
  inputProof: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}
