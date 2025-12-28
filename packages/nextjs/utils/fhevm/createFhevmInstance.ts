/**
 * createFhevmInstance - Create FHEVM instance with dynamic SDK loading
 *
 * This function handles:
 * 1. Loading SDK from CDN (browser only)
 * 2. Initializing SDK
 * 3. Creating instance with SepoliaConfig
 *
 * Simplified from: packages/dapps/packages/fhevm-sdk/src/internal/fhevm.ts
 */
import { getRelayerSDK, initSDK, isBrowser, isSDKInitialized, isSDKLoaded, loadSDK } from "./RelayerSDKLoader";
import type { FhevmInstance } from "./fhevmTypes";

/**
 * Status of FHEVM instance creation
 */
export type FhevmLoadStatus =
  | "idle"
  | "sdk-loading"
  | "sdk-loaded"
  | "sdk-initializing"
  | "sdk-initialized"
  | "creating"
  | "ready"
  | "error";

/**
 * Error thrown when FHEVM operation is aborted
 */
export class FhevmAbortError extends Error {
  constructor(message = "FHEVM operation was cancelled") {
    super(message);
    this.name = "FhevmAbortError";
  }
}

/**
 * Options for creating FHEVM instance
 */
export interface CreateFhevmInstanceOptions {
  /**
   * AbortSignal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Callback for status changes during creation
   */
  onStatusChange?: (status: FhevmLoadStatus) => void;
}

/**
 * Create FHEVM instance with dynamic SDK loading
 *
 * This is the main entry point for getting an FHEVM instance.
 * It handles all the loading/initialization steps.
 *
 * @param options - Options including abort signal and status callback
 * @returns Promise resolving to FhevmInstance
 * @throws FhevmAbortError if aborted
 * @throws Error if not in browser or SDK fails to load/initialize
 */
export async function createFhevmInstance(options: CreateFhevmInstanceOptions = {}): Promise<FhevmInstance> {
  const { signal, onStatusChange } = options;

  const notify = (status: FhevmLoadStatus) => {
    console.log(`[createFhevmInstance] Status: ${status}`);
    onStatusChange?.(status);
  };

  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new FhevmAbortError();
    }
  };

  // Must be in browser
  if (!isBrowser()) {
    throw new Error("createFhevmInstance: Can only be called in browser environment");
  }

  throwIfAborted();

  // Step 1: Load SDK from CDN if not already loaded
  if (!isSDKLoaded()) {
    notify("sdk-loading");
    await loadSDK();
    throwIfAborted();
  }
  notify("sdk-loaded");

  // Step 2: Initialize SDK if not already initialized
  if (!isSDKInitialized()) {
    notify("sdk-initializing");
    await initSDK();
    throwIfAborted();
  }
  notify("sdk-initialized");

  // Step 3: Create instance using SepoliaConfig
  notify("creating");

  const relayerSDK = getRelayerSDK();
  const config = {
    ...relayerSDK.SepoliaConfig,
  };

  console.log("[createFhevmInstance] Creating instance with config:", {
    aclContractAddress: config.aclContractAddress,
    chainId: config.chainId,
    gatewayUrl: config.gatewayUrl,
  });

  const instance = await relayerSDK.createInstance(config);

  throwIfAborted();

  notify("ready");
  console.log("[createFhevmInstance] Instance created successfully");

  return instance;
}

/**
 * Export types for convenience
 */
export type { FhevmInstance } from "./fhevmTypes";
