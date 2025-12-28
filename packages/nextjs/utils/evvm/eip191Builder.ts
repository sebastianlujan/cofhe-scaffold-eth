/**
 * EIP-191 Message Builder for EVVM Gasless Transactions
 *
 * This module creates EIP-191 message strings for gasless coffee orders.
 * Users sign this message off-chain (no gas), and fishers submit it on-chain.
 *
 * Message Format (EVVM Standard):
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 *
 * Example:
 * "1,orderCoffee,0x1234...,espresso,2,1,0x5678...,0,1735689600,1"
 */

import { Address, Hex, keccak256 } from "viem";

// ============ Types ============

/**
 * Parameters for a gasless coffee order
 */
export interface CoffeeOrderParams {
  serviceId: number;
  client: Address;
  coffeeType: string;
  quantity: bigint;
  serviceNonce: bigint;
  amountCommitment: Hex;
  evvmNonce: bigint;
  deadline: bigint;
  priorityFee: bigint;
}

// ============ Constants ============

/**
 * Default service ID for EVVM Cafe
 */
export const CAFE_SERVICE_ID = 1;

/**
 * Default priority fee for fisher (in tokens)
 * This is the reward paid to the fisher for executing the transaction
 */
export const DEFAULT_PRIORITY_FEE = 1n;

/**
 * Default deadline offset (5 minutes from now)
 */
export const DEFAULT_DEADLINE_OFFSET_SECONDS = 5 * 60;

// ============ Builder Functions ============

/**
 * Converts an address to lowercase hex string (EVVM format)
 * @param addr The address to convert
 * @returns Lowercase hex string with 0x prefix
 */
export function addressToLowercase(addr: Address): string {
  return addr.toLowerCase();
}

/**
 * Creates the amount commitment hash from encrypted handle
 *
 * The amount commitment is used to bind the signature to a specific encrypted amount.
 * This prevents signature replay with different amounts.
 *
 * Must match the contract's _createAmountCommitment function:
 *   keccak256(abi.encodePacked(externalEuint64.unwrap(amount)))
 *
 * @param encryptedHandle - The encrypted amount handle (0x... hex string, bytes32)
 * @returns bytes32 commitment (keccak256 hash of the handle)
 */
export function createAmountCommitment(encryptedHandle: Hex): Hex {
  return keccak256(encryptedHandle);
}

/**
 * Creates a deadline timestamp
 *
 * @param offsetSeconds - Seconds from now until deadline (default: 5 minutes)
 * @returns Unix timestamp as bigint
 */
export function createDeadline(offsetSeconds: number = DEFAULT_DEADLINE_OFFSET_SECONDS): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Builds the EIP-191 message string for a coffee order
 *
 * Format: "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 *
 * @param params - Order parameters
 * @returns Message string to be signed
 */
export function buildOrderMessage(params: CoffeeOrderParams): string {
  const {
    serviceId,
    client,
    coffeeType,
    quantity,
    serviceNonce,
    amountCommitment,
    evvmNonce,
    deadline,
    priorityFee,
  } = params;

  return [
    serviceId.toString(),
    "orderCoffee",
    addressToLowercase(client),
    coffeeType,
    quantity.toString(),
    serviceNonce.toString(),
    amountCommitment.toLowerCase(), // bytes32 as lowercase hex
    evvmNonce.toString(),
    deadline.toString(),
    priorityFee.toString(),
  ].join(",");
}

/**
 * Builds complete order data for signing and submission
 *
 * @param params - Order parameters (without computed fields)
 * @returns Complete order data including message and all parameters
 */
export function buildCoffeeOrderData(params: {
  client: Address;
  coffeeType: string;
  quantity: bigint;
  evvmNonce: bigint;
  serviceNonce: bigint;
  encryptedHandle: Hex;
  priorityFee?: bigint;
  deadlineSeconds?: number;
  serviceId?: number;
}): {
  message: string;
  params: CoffeeOrderParams;
} {
  const {
    client,
    coffeeType,
    quantity,
    evvmNonce,
    serviceNonce,
    encryptedHandle,
    priorityFee = DEFAULT_PRIORITY_FEE,
    deadlineSeconds = DEFAULT_DEADLINE_OFFSET_SECONDS,
    serviceId = CAFE_SERVICE_ID,
  } = params;

  const amountCommitment = createAmountCommitment(encryptedHandle);
  const deadline = createDeadline(deadlineSeconds);

  const orderParams: CoffeeOrderParams = {
    serviceId,
    client,
    coffeeType,
    quantity,
    serviceNonce,
    amountCommitment,
    evvmNonce,
    deadline,
    priorityFee,
  };

  const message = buildOrderMessage(orderParams);

  return {
    message,
    params: orderParams,
  };
}

/**
 * Validates that a deadline hasn't expired
 *
 * @param deadline - Unix timestamp as bigint
 * @returns true if deadline is in the future
 */
export function isDeadlineValid(deadline: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return deadline > now;
}

/**
 * Gets remaining time until deadline
 *
 * @param deadline - Unix timestamp as bigint
 * @returns Seconds remaining (negative if expired)
 */
export function getTimeUntilDeadline(deadline: bigint): number {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return Number(deadline - now);
}
