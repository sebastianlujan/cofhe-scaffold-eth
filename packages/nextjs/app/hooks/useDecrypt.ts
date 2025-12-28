"use client";

import { useCallback, useEffect, useState } from "react";
import { useZamaFhevm } from "./useZamaFhevm";
import { useAccount, useWalletClient } from "wagmi";

export type DecryptionState = "idle" | "pending" | "success" | "error" | "no-data" | "encrypted";

export interface DecryptResult {
  value: bigint | null;
  state: DecryptionState;
  error: string | null;
}

export interface UsePublicDecryptResult {
  decrypt: (handle: bigint | string) => Promise<bigint | null>;
  isDecrypting: boolean;
  error: string | null;
}

/**
 * Hook for PUBLIC decryption (Demo Mode)
 *
 * Use this when contracts call FHE.makePubliclyDecryptable()
 * Anyone can decrypt these values - NO PRIVACY
 *
 * This is the default mode for the current deployed contracts.
 */
export function usePublicDecrypt(): UsePublicDecryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decrypt = useCallback(
    async (handle: bigint | string): Promise<bigint | null> => {
      if (!instance || !isInitialized) {
        setError("FHEVM not initialized");
        return null;
      }

      // Handle zero/null cases
      const handleBigInt = typeof handle === "string" ? BigInt(handle) : handle;
      if (handleBigInt === 0n) {
        console.log("[Decrypt] Handle is zero, returning 0n");
        return 0n;
      }

      setIsDecrypting(true);
      setError(null);

      try {
        // Convert bigint to hex string for API
        const handleHex = `0x${handleBigInt.toString(16)}` as `0x${string}`;
        console.log("[Decrypt] Starting public decryption for handle:", handleHex);

        // Public decryption - expects array of handles, returns { clearValues, abiEncodedClearValues, decryptionProof }
        const results = await instance.publicDecrypt([handleHex]);

        // Get the decrypted value from clearValues map
        const decryptedValue = results.clearValues[handleHex];
        console.log("[Decrypt] Decrypted value:", decryptedValue);

        if (decryptedValue === undefined) {
          throw new Error("Handle not found in decryption results");
        }

        // Handle different return types (bigint | boolean | `0x${string}`)
        if (typeof decryptedValue === "bigint") {
          return decryptedValue;
        } else if (typeof decryptedValue === "boolean") {
          return decryptedValue ? 1n : 0n;
        } else if (typeof decryptedValue === "string") {
          return BigInt(decryptedValue);
        }

        return BigInt(decryptedValue as string);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Decryption failed";
        setError(message);
        console.error("[Decrypt] Public decryption error:", err);
        return null;
      } finally {
        setIsDecrypting(false);
      }
    },
    [instance, isInitialized],
  );

  return { decrypt, isDecrypting, error };
}

/**
 * Hook for reactive decryption with state management
 *
 * Use this in components that need to display encrypted values
 * and allow users to trigger decryption
 *
 * Usage:
 * ```typescript
 * const { value, state, onDecrypt } = useDecryptValue(balanceHandle);
 *
 * // In JSX:
 * {state === "encrypted" && <button onClick={onDecrypt}>Decrypt</button>}
 * {state === "success" && <span>{value?.toString()} tokens</span>}
 * ```
 */
export function useDecryptValue(ctHash: bigint | null | undefined): DecryptResult & { onDecrypt: () => Promise<void> } {
  const { decrypt, isDecrypting, error } = usePublicDecrypt();
  const [value, setValue] = useState<bigint | null>(null);
  const [state, setState] = useState<DecryptionState>("idle");

  // Determine initial state based on ctHash
  useEffect(() => {
    if (ctHash === null || ctHash === undefined) {
      setState("no-data");
      setValue(null);
    } else if (ctHash === 0n) {
      setState("success");
      setValue(0n);
    } else {
      setState("encrypted");
      setValue(null);
    }
  }, [ctHash]);

  const onDecrypt = useCallback(async () => {
    if (ctHash === null || ctHash === undefined) {
      setState("no-data");
      return;
    }

    if (ctHash === 0n) {
      setState("success");
      setValue(0n);
      return;
    }

    setState("pending");
    const result = await decrypt(ctHash);

    if (result !== null) {
      setValue(result);
      setState("success");
    } else {
      setState("error");
    }
  }, [ctHash, decrypt]);

  return {
    value,
    state: isDecrypting ? "pending" : state,
    error,
    onDecrypt,
  };
}

/**
 * Hook for USER decryption (Privacy Mode - Future Use)
 *
 * Use this when contracts call FHE.allow(value, userAddress)
 * Only authorized users can decrypt - TRUE PRIVACY
 *
 * Requires EIP-712 signature from user each time.
 *
 * NOTE: Current contracts use makePubliclyDecryptable(), so this won't work
 * until contracts are updated to use FHE.allow().
 */
export interface UseUserDecryptResult {
  decrypt: (handle: bigint | string, contractAddress: string) => Promise<bigint | null>;
  isDecrypting: boolean;
  error: string | null;
}

export function useUserDecrypt(): UseUserDecryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decrypt = useCallback(
    async (handle: bigint | string, contractAddress: string): Promise<bigint | null> => {
      if (!instance || !isInitialized) {
        setError("FHEVM not initialized");
        return null;
      }

      if (!address || !walletClient) {
        setError("Wallet not connected");
        return null;
      }

      const handleBigInt = typeof handle === "string" ? BigInt(handle) : handle;
      if (handleBigInt === 0n) {
        return 0n;
      }

      setIsDecrypting(true);
      setError(null);

      try {
        console.log("[UserDecrypt] Starting user decryption for handle:", handleBigInt.toString());
        console.log("[UserDecrypt] Contract:", contractAddress);
        console.log("[UserDecrypt] User:", address);

        // Generate keypair for this decryption session
        const keypair = instance.generateKeypair();

        // Create EIP-712 signature request
        const startTimestamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = "10";

        const eip712 = instance.createEIP712(keypair.publicKey, [contractAddress], startTimestamp, durationDays);

        console.log("[UserDecrypt] EIP-712 domain:", eip712.domain);
        console.log("[UserDecrypt] Requesting signature...");

        // User signs the request
        const signature = await walletClient.signTypedData({
          domain: eip712.domain as Parameters<typeof walletClient.signTypedData>[0]["domain"],
          types: eip712.types as Parameters<typeof walletClient.signTypedData>[0]["types"],
          primaryType: "UserDecryptRequestVerification",
          message: eip712.message as Record<string, unknown>,
        });

        console.log("[UserDecrypt] Signature obtained, performing decryption...");

        // Convert handle to hex string
        const handleHex = `0x${handleBigInt.toString(16)}` as `0x${string}`;

        // Perform user decryption
        const result = await instance.userDecrypt(
          [{ handle: handleHex, contractAddress: contractAddress as `0x${string}` }],
          keypair.privateKey,
          keypair.publicKey,
          signature.replace("0x", ""),
          [contractAddress as `0x${string}`],
          address as `0x${string}`,
          startTimestamp,
          durationDays,
        );

        // Result is ClearValues type: Record<`0x${string}`, bigint | boolean | `0x${string}`>
        const decryptedValue = result[handleHex];
        console.log("[UserDecrypt] Decrypted value:", decryptedValue);

        if (decryptedValue === undefined) {
          return null;
        }

        // Handle different return types
        if (typeof decryptedValue === "bigint") {
          return decryptedValue;
        } else if (typeof decryptedValue === "boolean") {
          return decryptedValue ? 1n : 0n;
        } else {
          return BigInt(decryptedValue);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "User decryption failed";
        setError(message);
        console.error("[UserDecrypt] Error:", err);
        return null;
      } finally {
        setIsDecrypting(false);
      }
    },
    [instance, isInitialized, address, walletClient],
  );

  return { decrypt, isDecrypting, error };
}
