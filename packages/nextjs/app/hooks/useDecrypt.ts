"use client";

import { useCallback, useEffect, useState } from "react";
import { useZamaFhevm } from "./useZamaFhevm";
import { useAccount, useWalletClient } from "wagmi";

// ============ Configuration ============

const MAX_SDK_RETRIES = 0; // Skip SDK retries - go straight to proxy on first failure (CORS issues in dev)
const INITIAL_DELAY_MS = 1500;
const MAX_DELAY_MS = 6000;

// ============ Types ============

export type DecryptionState = "idle" | "pending" | "success" | "error" | "no-data" | "encrypted" | "retrying";

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

// ============ Helpers ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on timeout, network errors, relayer issues
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("504") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("relayer didn't respond") ||
      message.includes("cors") ||
      message.includes("err_failed")
    );
  }
  return false;
}

// ============ Proxy Decryption ============

interface ProxyDecryptResponse {
  success: boolean;
  clearValues?: Record<string, string>;
  error?: string;
}

async function decryptViaProxy(handleHex: string): Promise<bigint | null> {
  console.log("[Decrypt] Attempting proxy decryption for:", handleHex.slice(0, 20) + "...");

  const response = await fetch("/api/decrypt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handles: [handleHex] }),
  });

  const data = (await response.json()) as ProxyDecryptResponse;

  if (!data.success) {
    throw new Error(data.error || "Proxy decryption failed");
  }

  if (!data.clearValues || Object.keys(data.clearValues).length === 0) {
    throw new Error("No decrypted values returned from proxy");
  }

  // Find the value - try multiple matching strategies
  let value: string | undefined;
  
  // Strategy 1: Exact match
  value = data.clearValues[handleHex];
  
  // Strategy 2: Case-insensitive match
  if (value === undefined) {
    value = data.clearValues[handleHex.toLowerCase()];
  }
  
  // Strategy 3: Find any key that ends with the same suffix (handles might have different padding)
  if (value === undefined) {
    const handleSuffix = handleHex.toLowerCase().replace(/^0x0*/, ''); // Remove 0x and leading zeros
    const key = Object.keys(data.clearValues).find(k => {
      const keySuffix = k.toLowerCase().replace(/^0x0*/, '');
      return keySuffix === handleSuffix || handleSuffix.endsWith(keySuffix) || keySuffix.endsWith(handleSuffix);
    });
    if (key) {
      value = data.clearValues[key];
    }
  }
  
  // Strategy 4: If only one value returned, use it (single handle request)
  if (value === undefined && Object.keys(data.clearValues).length === 1) {
    value = Object.values(data.clearValues)[0];
    console.log("[Decrypt] Using single returned value");
  }

  if (value === undefined) {
    console.error("[Decrypt] Handle not found in proxy response.");
    console.error("[Decrypt] Requested handle:", handleHex);
    console.error("[Decrypt] Available keys:", Object.keys(data.clearValues));
    throw new Error("Handle not found in proxy decryption results");
  }

  console.log("[Decrypt] Proxy decryption successful:", value);
  return BigInt(value);
}

// ============ SDK Decryption with Retry ============

async function decryptWithSDKRetry(
  instance: { publicDecrypt: (handles: `0x${string}`[]) => Promise<{ clearValues: Record<string, unknown> }> },
  handleHex: `0x${string}`,
  attempt = 0,
): Promise<bigint | null> {
  try {
    console.log(`[Decrypt] SDK attempt ${attempt + 1}/${MAX_SDK_RETRIES + 1} for:`, handleHex.slice(0, 20) + "...");

    const results = await instance.publicDecrypt([handleHex]);
    const decryptedValue = results.clearValues[handleHex];

    if (decryptedValue === undefined) {
      throw new Error("Handle not found in decryption results");
    }

    // Handle different return types
    if (typeof decryptedValue === "bigint") {
      return decryptedValue;
    } else if (typeof decryptedValue === "boolean") {
      return decryptedValue ? 1n : 0n;
    } else if (typeof decryptedValue === "string") {
      return BigInt(decryptedValue);
    }

    return BigInt(decryptedValue as string);
  } catch (err) {
    console.log(`[Decrypt] SDK attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);

    if (attempt < MAX_SDK_RETRIES && isRetryableError(err)) {
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      console.log(`[Decrypt] Retrying SDK in ${delay}ms...`);
      await sleep(delay);
      return decryptWithSDKRetry(instance, handleHex, attempt + 1);
    }

    throw err;
  }
}

/**
 * Hook for PUBLIC decryption (Demo Mode)
 *
 * Features:
 * - Retry logic with exponential backoff for SDK calls
 * - Fallback to server-side proxy if SDK fails (bypasses CORS)
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

      // Convert bigint to hex string for API
      // Pad to 64 characters (32 bytes) as Zama expects full-length handles
      const hexWithoutPrefix = handleBigInt.toString(16).padStart(64, '0');
      const handleHex = `0x${hexWithoutPrefix}` as `0x${string}`;
      console.log("[Decrypt] Starting public decryption for handle:", handleHex);

      try {
        // Strategy 1: Try SDK with retries first
        const result = await decryptWithSDKRetry(instance, handleHex);
        console.log("[Decrypt] SDK decryption successful:", result);
        return result;
      } catch (sdkError) {
        console.warn("[Decrypt] SDK decryption failed after retries:", sdkError instanceof Error ? sdkError.message : sdkError);

        // Strategy 2: Fallback to proxy
        try {
          console.log("[Decrypt] Falling back to proxy...");
          const proxyResult = await decryptViaProxy(handleHex);
          console.log("[Decrypt] Proxy decryption successful:", proxyResult);
          return proxyResult;
        } catch (proxyError) {
          // Both strategies failed
          const message = proxyError instanceof Error ? proxyError.message : "Decryption failed";
          setError(`Decryption failed (SDK & Proxy): ${message}`);
          console.error("[Decrypt] Both SDK and Proxy failed:", proxyError);
          return null;
        }
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
