/**
 * @file mockFHE.ts
 * @description Mock FHE utilities for testing EVVM contracts
 *
 * This module provides utilities for testing contracts that use FHE
 * without requiring actual FHE infrastructure. Values are mocked
 * to allow testing of contract logic.
 *
 * NOTE: These mocks do NOT provide actual encryption. They are for
 * testing contract logic only. Real FHE tests require Zama FHEVM.
 */

import { ethers } from "hardhat";

/**
 * Mock external encrypted uint64 handle
 * In real FHE, this would be an encrypted ciphertext handle
 */
export interface MockExternalEuint64 {
  handle: string; // bytes32 handle
  value: bigint; // plaintext value (for test verification)
  inputProof: string; // mock ZK proof
}

/**
 * Counter for generating unique handles
 */
let handleCounter = 0;

/**
 * Creates a mock external encrypted uint64
 * @param value - The plaintext value to "encrypt"
 * @returns Mock external encrypted handle with proof
 */
export function createMockExternalEuint64(value: bigint): MockExternalEuint64 {
  handleCounter++;

  // Create deterministic handle based on value and counter
  const handle = ethers.keccak256(
    ethers.solidityPacked(["string", "uint256", "uint256"], ["mock_euint64", value, handleCounter]),
  );

  // Create mock input proof (64 bytes of deterministic data)
  const inputProof =
    ethers.keccak256(ethers.solidityPacked(["string", "bytes32"], ["mock_proof", handle])) +
    ethers
      .keccak256(ethers.solidityPacked(["string", "bytes32", "uint256"], ["mock_proof_ext", handle, value]))
      .slice(2); // Remove 0x prefix from second hash

  return {
    handle,
    value,
    inputProof,
  };
}

/**
 * Creates a mock encrypted secret for Plan 2A testing
 * @param secretValue - The plaintext secret value
 * @returns Mock external encrypted handle with proof
 */
export function createMockSecret(secretValue: bigint): MockExternalEuint64 {
  return createMockExternalEuint64(secretValue);
}

/**
 * Creates a mock amount commitment from an encrypted handle
 * This matches the contract's commitment creation logic
 * @param handle - The external encrypted handle (bytes32)
 * @returns The commitment hash
 */
export function createAmountCommitment(handle: string): string {
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [handle]));
}

/**
 * Batch create multiple mock encrypted values
 * @param values - Array of plaintext values
 * @returns Array of mock encrypted handles
 */
export function createMockBatch(values: bigint[]): MockExternalEuint64[] {
  return values.map(v => createMockExternalEuint64(v));
}

/**
 * Reset the handle counter (useful between tests)
 */
export function resetMockFHE(): void {
  handleCounter = 0;
}

/**
 * Type guard to check if a value looks like a valid handle
 */
export function isValidHandle(handle: string): boolean {
  return handle.startsWith("0x") && handle.length === 66; // 0x + 64 hex chars
}

/**
 * Convert a mock handle back to its commitment
 * (useful for signature creation in tests)
 */
export function handleToCommitment(handle: string): string {
  return createAmountCommitment(handle);
}

/**
 * Test helper: Create a transfer with mock FHE values
 */
export interface MockTransferParams {
  fromVaddr: string;
  toVaddr: string;
  amount: MockExternalEuint64;
  nonce: bigint;
}

export function createMockTransfer(
  fromVaddr: string,
  toVaddr: string,
  amountValue: bigint,
  nonce: bigint,
): MockTransferParams {
  return {
    fromVaddr,
    toVaddr,
    amount: createMockExternalEuint64(amountValue),
    nonce,
  };
}

/**
 * Test helper: Create batch transfer params
 */
export interface MockBatchTransferParams {
  fromVaddr: string;
  toVaddr: string;
  amount: string; // handle
  inputProof: string; // proof bytes
  expectedNonce: bigint;
}

export function createMockBatchTransferParams(
  transfers: Array<{
    fromVaddr: string;
    toVaddr: string;
    amountValue: bigint;
    nonce: bigint;
  }>,
): MockBatchTransferParams[] {
  return transfers.map(t => {
    const mockAmount = createMockExternalEuint64(t.amountValue);
    return {
      fromVaddr: t.fromVaddr,
      toVaddr: t.toVaddr,
      amount: mockAmount.handle,
      inputProof: mockAmount.inputProof,
      expectedNonce: t.nonce,
    };
  });
}

/**
 * Constants for common test values
 */
export const MOCK_VALUES = {
  INITIAL_BALANCE: 1000n,
  TRANSFER_AMOUNT: 100n,
  SMALL_AMOUNT: 10n,
  LARGE_AMOUNT: 500n,
  ZERO: 0n,
  SECRET: 123456789n,
  WRONG_SECRET: 987654321n,
} as const;

/**
 * Pre-created mock values for common test scenarios
 */
export const MOCK_PRESETS = {
  initialBalance: () => createMockExternalEuint64(MOCK_VALUES.INITIAL_BALANCE),
  transferAmount: () => createMockExternalEuint64(MOCK_VALUES.TRANSFER_AMOUNT),
  smallAmount: () => createMockExternalEuint64(MOCK_VALUES.SMALL_AMOUNT),
  largeAmount: () => createMockExternalEuint64(MOCK_VALUES.LARGE_AMOUNT),
  zeroAmount: () => createMockExternalEuint64(MOCK_VALUES.ZERO),
  validSecret: () => createMockSecret(MOCK_VALUES.SECRET),
  wrongSecret: () => createMockSecret(MOCK_VALUES.WRONG_SECRET),
} as const;
