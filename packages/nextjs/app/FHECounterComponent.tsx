"use client";

import { useZamaFhevm } from "./hooks/useZamaFhevm";

/**
 * FHECounterComponent - A placeholder for the FHE Counter demo
 *
 * NOTE: The FHECounter contract is not deployed in this version.
 * This project focuses on the EVVM Cafe demo with EVVMCore and EVVMCafe contracts.
 *
 * To use this component, you would need to:
 * 1. Deploy the FHECounter contract
 * 2. Update deployedContracts.ts with the FHECounter ABI and address
 * 3. Uncomment the full implementation below
 */

export const FHECounterComponent = () => {
  const { isInitialized, isInitializing, error } = useZamaFhevm();

  return (
    <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center rounded-3xl gap-4">
      <p className="font-bold text-xl">Zama FHEVM Demo</p>

      {/* FHEVM Status */}
      <div className="flex flex-col gap-2">
        {isInitializing && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="loading loading-spinner loading-xs"></span>
            Initializing FHEVM...
          </div>
        )}

        {error && <div className="text-sm text-error">FHEVM Error: {error}</div>}

        {isInitialized && <div className="text-sm text-success">FHEVM Ready (Sepolia)</div>}

        {!isInitialized && !isInitializing && !error && (
          <div className="text-sm text-warning">Connect to Sepolia for FHE features</div>
        )}
      </div>

      {/* Info about available demos */}
      <div className="mt-4 p-4 bg-base-200 rounded-lg">
        <p className="text-sm text-gray-600 mb-2">This scaffold includes:</p>
        <ul className="text-sm text-left list-disc list-inside space-y-1">
          <li>
            <strong>EVVMCore</strong> - Encrypted Virtual Value Machine
          </li>
          <li>
            <strong>EVVMCafe</strong> - Demo coffee shop with FHE payments
          </li>
        </ul>
        <p className="text-sm mt-4">
          <a href="/evvm-cafe" className="link link-primary font-semibold">
            Try the EVVM Cafe Demo
          </a>
        </p>
      </div>

      <div className="text-xs text-gray-400 mt-4">SDK: @zama-fhe/relayer-sdk | Network: Sepolia</div>
    </div>
  );
};
