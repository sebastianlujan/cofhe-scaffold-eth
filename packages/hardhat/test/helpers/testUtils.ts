/**
 * @file testUtils.ts
 * @description Test utilities for EVVM contract testing
 *
 * Provides helper functions for:
 * - Signature generation (EIP-191)
 * - Virtual address generation
 * - Mock encrypted input creation
 */

import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Signature components for EIP-191 signatures
 */
export interface Signature {
  v: number;
  r: string;
  s: string;
}

/**
 * Generate a virtual address from an Ethereum address
 * @param address - Ethereum address
 * @param vChainId - Virtual chain ID
 * @param evvmID - EVVM ID
 * @returns bytes32 virtual address
 */
export function generateVaddr(address: string, vChainId: bigint, evvmID: bigint): string {
  return ethers.keccak256(ethers.solidityPacked(["address", "uint64", "uint256"], [address, vChainId, evvmID]));
}

/**
 * Create a message hash for EVVM transfer (matches contract's getTransferMessageHash)
 */
export async function createTransferMessageHash(
  evvmCore: any,
  fromVaddr: string,
  toVaddr: string,
  amountCommitment: string,
  nonce: bigint,
  deadline: bigint,
): Promise<string> {
  return await evvmCore.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, nonce, deadline);
}

/**
 * Sign a message hash using EIP-191 personal_sign
 * @param signer - The signer to use
 * @param messageHash - The message hash to sign
 * @returns Signature components (v, r, s)
 */
export async function signMessageHash(signer: SignerWithAddress, messageHash: string): Promise<Signature> {
  // Sign using personal_sign (EIP-191)
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  const sig = ethers.Signature.from(signature);

  return {
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}

/**
 * Create a complete signed transfer with all parameters
 */
export async function createSignedTransferParams(
  evvmCore: any,
  signer: SignerWithAddress,
  fromVaddr: string,
  toVaddr: string,
  amountHandle: string, // The externalEuint64 handle
  nonce: bigint,
  deadline: bigint,
): Promise<{ messageHash: string; signature: Signature; amountCommitment: string }> {
  // Create amount commitment (hash of the handle)
  const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

  // Get the message hash from the contract
  const messageHash = await createTransferMessageHash(evvmCore, fromVaddr, toVaddr, amountCommitment, nonce, deadline);

  // Sign it
  const signature = await signMessageHash(signer, messageHash);

  return { messageHash, signature, amountCommitment };
}

/**
 * Get current timestamp + offset in seconds
 */
export function futureTimestamp(offsetSeconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
}

/**
 * Get past timestamp (already expired)
 */
export function pastTimestamp(offsetSeconds: number = 100): bigint {
  return BigInt(Math.floor(Date.now() / 1000) - offsetSeconds);
}

/**
 * Create a mock encrypted handle (for testing without FHE)
 * In real usage, this would come from the FHE encryption process
 */
export function mockEncryptedHandle(value: bigint): string {
  // Create a deterministic "handle" based on value for testing
  return ethers.keccak256(ethers.solidityPacked(["string", "uint256"], ["mock_handle", value]));
}

/**
 * Create mock input proof (for testing without FHE)
 */
export function mockInputProof(): string {
  return ethers.hexlify(ethers.randomBytes(64));
}

/**
 * Wait for a specific number of blocks
 */
export async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

/**
 * Advance time by specified seconds
 */
export async function advanceTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Get current block timestamp
 */
export async function getCurrentTimestamp(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}
