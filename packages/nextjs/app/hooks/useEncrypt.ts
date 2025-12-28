"use client";

import { useCallback, useState } from "react";
import { useZamaFhevm } from "./useZamaFhevm";
import { useAccount } from "wagmi";

/**
 * Convert Uint8Array to hex string for contract calls
 *
 * CRITICAL: Zama SDK returns Uint8Array, but contracts expect hex strings!
 */
export const toHex = (value: Uint8Array): `0x${string}` => ("0x" + Buffer.from(value).toString("hex")) as `0x${string}`;

export interface EncryptedInput {
  handles: `0x${string}`[];
  inputProof: `0x${string}`;
}

export type EncryptValueType =
  | { type: "bool"; value: boolean }
  | { type: "uint8"; value: bigint }
  | { type: "uint16"; value: bigint }
  | { type: "uint32"; value: bigint }
  | { type: "uint64"; value: bigint }
  | { type: "uint128"; value: bigint }
  | { type: "uint256"; value: bigint }
  | { type: "address"; value: string };

export interface UseEncryptResult {
  encrypt: (contractAddress: string, values: EncryptValueType[], userAddress?: string) => Promise<EncryptedInput | null>;
  encryptUint64: (contractAddress: string, value: bigint, userAddress?: string) => Promise<EncryptedInput | null>;
  encryptUint32: (contractAddress: string, value: bigint, userAddress?: string) => Promise<EncryptedInput | null>;
  isEncrypting: boolean;
  error: string | null;
  encryptionDisabled: boolean;
}

/**
 * Hook for encrypting values using Zama FHEVM
 *
 * Usage:
 * ```typescript
 * const { encryptUint64 } = useEncrypt();
 * const encrypted = await encryptUint64(contractAddress, BigInt(amount));
 *
 * // Use in contract call:
 * await contract.registerAccount(vaddr, encrypted.handles[0], encrypted.inputProof);
 * ```
 */
export function useEncrypt(): UseEncryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const { address } = useAccount();
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encrypt = useCallback(
    async (contractAddress: string, values: EncryptValueType[], userAddress?: string): Promise<EncryptedInput | null> => {
      if (!instance || !isInitialized) {
        setError("FHEVM not initialized");
        return null;
      }

      // Use provided userAddress or fall back to connected wallet
      const targetUserAddress = userAddress || address;
      
      if (!targetUserAddress) {
        setError("Wallet not connected and no userAddress provided");
        return null;
      }

      setIsEncrypting(true);
      setError(null);

      try {
        console.log("[Encrypt] Creating encrypted input for contract:", contractAddress);
        console.log("[Encrypt] User address:", targetUserAddress);
        console.log("[Encrypt] Values:", values);

        // Create encrypted input buffer bound to contract and user
        // For cross-contract calls (e.g., gasless), userAddress should be the contract that calls FHE.asEuint64
        const buffer = instance.createEncryptedInput(contractAddress, targetUserAddress);

        // Add all values to the buffer
        for (const val of values) {
          switch (val.type) {
            case "bool":
              buffer.addBool(val.value);
              break;
            case "uint8":
              buffer.add8(val.value);
              break;
            case "uint16":
              buffer.add16(val.value);
              break;
            case "uint32":
              buffer.add32(val.value);
              break;
            case "uint64":
              buffer.add64(val.value);
              break;
            case "uint128":
              buffer.add128(val.value);
              break;
            case "uint256":
              buffer.add256(val.value);
              break;
            case "address":
              buffer.addAddress(val.value);
              break;
          }
        }

        // Encrypt and get raw Uint8Array results
        const result = await buffer.encrypt();

        console.log("[Encrypt] Raw result handles:", result.handles);
        console.log("[Encrypt] Raw result proof length:", result.inputProof.length);

        // Convert Uint8Array to hex strings for contract calls
        const hexHandles = result.handles.map(toHex);
        const hexProof = toHex(result.inputProof);

        console.log("[Encrypt] Hex handles:", hexHandles);
        console.log("[Encrypt] Hex proof:", hexProof.slice(0, 50) + "...");

        return {
          handles: hexHandles,
          inputProof: hexProof,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Encryption failed";
        setError(message);
        console.error("[Encrypt] Error:", err);
        return null;
      } finally {
        setIsEncrypting(false);
      }
    },
    [instance, isInitialized, address],
  );

  // Convenience method for uint64 (most common for balances)
  // userAddress: For cross-contract FHE calls, pass the contract that will call FHE.asEuint64
  const encryptUint64 = useCallback(
    (contractAddress: string, value: bigint, userAddress?: string) => 
      encrypt(contractAddress, [{ type: "uint64", value }], userAddress),
    [encrypt],
  );

  // Convenience method for uint32 (for counter)
  // userAddress: For cross-contract FHE calls, pass the contract that will call FHE.asEuint64
  const encryptUint32 = useCallback(
    (contractAddress: string, value: bigint, userAddress?: string) => 
      encrypt(contractAddress, [{ type: "uint32", value }], userAddress),
    [encrypt],
  );

  return {
    encrypt,
    encryptUint64,
    encryptUint32,
    isEncrypting,
    error,
    encryptionDisabled: !isInitialized || !address,
  };
}
