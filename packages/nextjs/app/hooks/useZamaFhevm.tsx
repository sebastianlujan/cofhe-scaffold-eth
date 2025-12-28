"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import {
  FhevmAbortError,
  FhevmInstance,
  FhevmLoadStatus,
  SEPOLIA_CHAIN_ID,
  createFhevmInstance,
  isBrowser,
} from "~~/utils/fhevm";
import { notification } from "~~/utils/scaffold-eth";

/**
 * FHEVM context state
 */
interface ZamaFhevmContextType {
  instance: FhevmInstance | null;
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  status: FhevmLoadStatus;
  reinitialize: () => void;
}

const ZamaFhevmContext = createContext<ZamaFhevmContextType>({
  instance: null,
  isInitialized: false,
  isInitializing: false,
  error: null,
  status: "idle",
  reinitialize: () => {},
});

/**
 * Hook to access FHEVM context
 */
export const useZamaFhevm = () => useContext(ZamaFhevmContext);

/**
 * ZamaFhevmProvider - Provides FHEVM instance to the app
 *
 * Uses dynamic SDK loading from CDN to avoid SSR issues.
 * Only initializes when:
 * 1. Running in browser
 * 2. Wallet is connected
 * 3. Connected to Sepolia network
 */
export function ZamaFhevmProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [status, setStatus] = useState<FhevmLoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const { isConnected, chainId } = useAccount();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Derived state
  const isInitialized = status === "ready" && instance !== null;
  const isInitializing = status !== "idle" && status !== "ready" && status !== "error";
  const isSepoliaConnected = isConnected && chainId === SEPOLIA_CHAIN_ID;

  /**
   * Force re-initialization
   */
  const reinitialize = useCallback(() => {
    console.log("[useZamaFhevm] Reinitialize requested");

    // Abort any ongoing initialization
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset state
    setInstance(null);
    setStatus("idle");
    setError(null);

    // Trigger re-initialization
    setRefreshCounter(c => c + 1);
  }, []);

  /**
   * Main initialization effect
   */
  useEffect(() => {
    // Skip during SSR
    if (!isBrowser()) {
      console.log("[useZamaFhevm] Not in browser, skipping");
      return;
    }

    // Skip if not on Sepolia
    if (!isSepoliaConnected) {
      console.log("[useZamaFhevm] Not connected to Sepolia, skipping. ChainId:", chainId);
      if (isConnected && chainId !== SEPOLIA_CHAIN_ID) {
        setError("Please connect to Sepolia network for FHE features");
      } else {
        setError(null);
      }
      setInstance(null);
      setStatus("idle");
      return;
    }

    // Create abort controller for this initialization
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    console.log("[useZamaFhevm] Starting FHEVM initialization...");

    createFhevmInstance({
      signal: abortController.signal,
      onStatusChange: setStatus,
    })
      .then(inst => {
        if (abortController.signal.aborted) {
          console.log("[useZamaFhevm] Initialization aborted, ignoring result");
          return;
        }

        console.log("[useZamaFhevm] FHEVM instance created successfully");
        setInstance(inst);
        setError(null);
        notification.success("FHEVM connected successfully");
      })
      .catch(err => {
        if (abortController.signal.aborted) {
          console.log("[useZamaFhevm] Initialization aborted, ignoring error");
          return;
        }

        if (err instanceof FhevmAbortError) {
          console.log("[useZamaFhevm] Initialization was aborted");
          return;
        }

        const message = err instanceof Error ? err.message : "Failed to initialize FHEVM";
        console.error("[useZamaFhevm] Initialization error:", err);
        setError(message);
        setStatus("error");
        notification.error(`FHEVM error: ${message}`);
      });

    // Cleanup on unmount or re-run
    return () => {
      console.log("[useZamaFhevm] Cleanup - aborting any pending initialization");
      abortController.abort();
    };
  }, [isSepoliaConnected, isConnected, chainId, refreshCounter]);

  return (
    <ZamaFhevmContext.Provider
      value={{
        instance,
        isInitialized,
        isInitializing,
        error,
        status,
        reinitialize,
      }}
    >
      {children}
    </ZamaFhevmContext.Provider>
  );
}

/**
 * Check if FHEVM is ready for use
 */
export function useIsFhevmReady(): boolean {
  const { isInitialized, error } = useZamaFhevm();
  return isInitialized && !error;
}

/**
 * Get FHEVM instance (throws if not ready)
 */
export function useFhevmInstance(): FhevmInstance {
  const { instance } = useZamaFhevm();
  if (!instance) {
    throw new Error("FHEVM not initialized. Wrap your app in ZamaFhevmProvider and connect to Sepolia.");
  }
  return instance;
}

/**
 * Hook to check if connected to Sepolia
 */
export function useIsSepoliaConnected(): boolean {
  const { chainId, isConnected } = useAccount();
  return isConnected && chainId === SEPOLIA_CHAIN_ID;
}
