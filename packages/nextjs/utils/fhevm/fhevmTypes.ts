/**
 * Type definitions for Zama FHEVM Relayer SDK
 *
 * These types describe the shape of window.relayerSDK after CDN script loads
 */

/**
 * Encrypted input buffer for creating encrypted values
 */
export interface EncryptedInputBuffer {
  addBool(value: boolean): EncryptedInputBuffer;
  add8(value: bigint | number): EncryptedInputBuffer;
  add16(value: bigint | number): EncryptedInputBuffer;
  add32(value: bigint | number): EncryptedInputBuffer;
  add64(value: bigint | number): EncryptedInputBuffer;
  add128(value: bigint | number): EncryptedInputBuffer;
  add256(value: bigint | number): EncryptedInputBuffer;
  addAddress(value: string): EncryptedInputBuffer;
  encrypt(): Promise<{
    handles: Uint8Array[];
    inputProof: Uint8Array;
  }>;
}

/**
 * Clear values returned from decryption
 */
export type ClearValues = Record<`0x${string}`, bigint | boolean | `0x${string}`>;

/**
 * Public decryption result
 */
export interface PublicDecryptResult {
  clearValues: ClearValues;
  abiEncodedClearValues: `0x${string}`;
  decryptionProof: `0x${string}`;
}

/**
 * Handle + contract pair for user decryption
 */
export interface HandleContractPair {
  handle: `0x${string}`;
  contractAddress: `0x${string}`;
}

/**
 * EIP-712 typed data for user decryption signature
 */
export interface EIP712Data {
  domain: {
    chainId: number;
    name: string;
    verifyingContract: `0x${string}`;
    version: string;
  };
  message: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
}

/**
 * Keypair for user decryption
 */
export interface FhevmKeypair {
  publicKey: string;
  privateKey: string;
}

/**
 * FHEVM Instance - main interface for encryption/decryption operations
 */
export interface FhevmInstance {
  /**
   * Create encrypted input buffer bound to contract and user
   */
  createEncryptedInput(contractAddress: string, userAddress: string): EncryptedInputBuffer;

  /**
   * Public decryption - for values marked with makePubliclyDecryptable()
   * Anyone can decrypt these values
   */
  publicDecrypt(handles: `0x${string}`[]): Promise<PublicDecryptResult>;

  /**
   * Generate keypair for user decryption
   */
  generateKeypair(): FhevmKeypair;

  /**
   * Create EIP-712 typed data for user decryption signature
   */
  createEIP712(
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: string,
    durationDays: string,
  ): EIP712Data;

  /**
   * User decryption - for values allowed via FHE.allow()
   * Only authorized users can decrypt
   */
  userDecrypt(
    handleContractPairs: HandleContractPair[],
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: `0x${string}`[],
    userAddress: `0x${string}`,
    startTimestamp: string,
    durationDays: string,
  ): Promise<ClearValues>;

  /**
   * Get public key for the network
   */
  getPublicKey(): string;

  /**
   * Get public params for given size
   */
  getPublicParams(size: number): Uint8Array;
}

/**
 * Configuration for creating FHEVM instance
 */
export interface FhevmInstanceConfig {
  aclContractAddress: `0x${string}`;
  kmsContractAddress: `0x${string}`;
  gatewayUrl: string;
  chainId: number;
  network?: unknown;
  publicKey?: string;
  publicParams?: Uint8Array;
}

/**
 * SDK initialization options
 */
export interface FhevmInitSDKOptions {
  tfheParams?: unknown;
  kmsParams?: unknown;
  thread?: number;
}

/**
 * Shape of window.relayerSDK after CDN script loads
 */
export interface FhevmRelayerSDKType {
  initSDK: (options?: FhevmInitSDKOptions) => Promise<boolean>;
  createInstance: (config: FhevmInstanceConfig) => Promise<FhevmInstance>;
  SepoliaConfig: FhevmInstanceConfig;
  __initialized__?: boolean;
}

/**
 * Window type with relayerSDK attached
 */
export interface FhevmWindowType extends Window {
  relayerSDK: FhevmRelayerSDKType;
}

/**
 * Type guard to check if window has relayerSDK
 */
export function isFhevmWindow(win: unknown): win is FhevmWindowType {
  if (typeof win !== "object" || win === null) return false;
  if (!("relayerSDK" in win)) return false;
  const sdk = (win as { relayerSDK: unknown }).relayerSDK;
  if (typeof sdk !== "object" || sdk === null) return false;
  if (!("initSDK" in sdk) || typeof sdk.initSDK !== "function") return false;
  if (!("createInstance" in sdk) || typeof sdk.createInstance !== "function") return false;
  if (!("SepoliaConfig" in sdk) || typeof sdk.SepoliaConfig !== "object") return false;
  return true;
}
