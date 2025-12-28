/**
 * EIP-191 Signature Verification Utilities for Fisher Relayer
 *
 * This module validates signatures BEFORE submitting to the blockchain,
 * saving gas by rejecting invalid orders early.
 *
 * Message Format (must match contract's _buildOrderMessage exactly):
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 */

import { verifyMessage, keccak256, type Hex, type Address } from 'viem';

// ============ Constants ============

/**
 * Service ID for EVVM Cafe (must match contract's CAFE_SERVICE_ID)
 */
const CAFE_SERVICE_ID = 1;

// ============ Types ============

export interface OrderMessageParams {
  client: string;
  coffeeType: string;
  quantity: string;
  serviceNonce: string;
  amountCommitment: string;
  evvmNonce: string;
  deadline: string;
  priorityFee: string;
}

// ============ Message Building ============

/**
 * Builds the EIP-191 message for an order
 *
 * CRITICAL: This must match the contract's _buildOrderMessage() exactly!
 * Any difference will cause signature verification to fail.
 *
 * Contract location: EVVMCafeGasless.sol:214-243
 *
 * Format: "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 *
 * @param params - Order parameters
 * @returns Message string to verify against signature
 */
export function buildOrderMessage(params: OrderMessageParams): string {
  return [
    CAFE_SERVICE_ID.toString(),
    'orderCoffee',
    params.client.toLowerCase(), // Address must be lowercase
    params.coffeeType,
    params.quantity,
    params.serviceNonce,
    params.amountCommitment.toLowerCase(), // bytes32 must be lowercase
    params.evvmNonce,
    params.deadline,
    params.priorityFee,
  ].join(',');
}

// ============ Signature Verification ============

/**
 * Verifies an EIP-191 personal sign signature
 *
 * Uses viem's verifyMessage which:
 * 1. Prepends "\x19Ethereum Signed Message:\n{length}"
 * 2. Hashes the prefixed message
 * 3. Recovers the signer using ecrecover
 * 4. Compares recovered address to expected signer
 *
 * @param message - The message that was signed (without EIP-191 prefix)
 * @param signature - The signature (65 bytes: r + s + v)
 * @param expectedSigner - The address that should have signed
 * @returns true if signature is valid
 */
export async function verifyEIP191Signature(
  message: string,
  signature: Hex,
  expectedSigner: Address,
): Promise<boolean> {
  try {
    const isValid = await verifyMessage({
      address: expectedSigner,
      message,
      signature,
    });
    return isValid;
  } catch (error) {
    // Any error during verification means invalid signature
    return false;
  }
}

// ============ Amount Commitment ============

/**
 * Verifies that the amount commitment matches the encrypted amount
 *
 * The amount commitment is keccak256(encryptedAmountHandle).
 * This binds the signature to a specific encrypted value.
 *
 * Contract location: FheEvvmService.sol:264-266
 *
 * @param amountCommitment - The commitment from the signed message
 * @param encryptedAmount - The encrypted amount handle
 * @returns true if commitment matches
 */
export function verifyAmountCommitment(
  amountCommitment: Hex,
  encryptedAmount: Hex,
): boolean {
  const computed = keccak256(encryptedAmount);
  return computed.toLowerCase() === amountCommitment.toLowerCase();
}

// ============ Deadline Validation ============

/**
 * Checks if a deadline has not expired
 *
 * @param deadline - Unix timestamp as bigint
 * @returns true if deadline is in the future
 */
export function isDeadlineValid(deadline: bigint): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return deadline > now;
}

/**
 * Gets remaining time until deadline expires
 *
 * @param deadline - Unix timestamp as bigint
 * @returns Seconds remaining (negative if expired)
 */
export function getTimeUntilDeadline(deadline: bigint): number {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return Number(deadline - now);
}

// ============ Validation Result ============

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    deadlineValid: boolean;
    commitmentValid: boolean;
    signatureValid: boolean;
    quantityValid: boolean;
    priorityFeeValid: boolean;
  };
}

/**
 * Performs complete order validation
 *
 * @param params - Order parameters
 * @param signature - The EIP-191 signature
 * @param encryptedAmount - The encrypted amount handle
 * @param minPriorityFee - Minimum priority fee required (optional)
 * @returns Validation result with error details
 */
export async function validateOrder(
  params: OrderMessageParams,
  signature: Hex,
  encryptedAmount: Hex,
  minPriorityFee: bigint = 0n,
): Promise<ValidationResult> {
  const details = {
    deadlineValid: false,
    commitmentValid: false,
    signatureValid: false,
    quantityValid: false,
    priorityFeeValid: false,
  };

  // 1. Check deadline
  details.deadlineValid = isDeadlineValid(BigInt(params.deadline));
  if (!details.deadlineValid) {
    return {
      valid: false,
      error: 'Order has expired. Please try again.',
      details,
    };
  }

  // 2. Verify amount commitment
  details.commitmentValid = verifyAmountCommitment(
    params.amountCommitment as Hex,
    encryptedAmount,
  );
  if (!details.commitmentValid) {
    return {
      valid: false,
      error: 'Amount verification failed.',
      details,
    };
  }

  // 3. Verify EIP-191 signature
  const message = buildOrderMessage(params);
  details.signatureValid = await verifyEIP191Signature(
    message,
    signature,
    params.client as Address,
  );
  if (!details.signatureValid) {
    return {
      valid: false,
      error: 'Invalid signature. Please sign again.',
      details,
    };
  }

  // 4. Validate quantity
  details.quantityValid = BigInt(params.quantity) > 0n;
  if (!details.quantityValid) {
    return {
      valid: false,
      error: 'Please select a valid quantity.',
      details,
    };
  }

  // 5. Check priority fee meets minimum
  details.priorityFeeValid = BigInt(params.priorityFee) >= minPriorityFee;
  if (!details.priorityFeeValid) {
    return {
      valid: false,
      error: `Priority fee must be at least ${minPriorityFee}.`,
      details,
    };
  }

  return {
    valid: true,
    details,
  };
}
