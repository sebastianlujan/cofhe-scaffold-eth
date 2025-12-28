# Frontend Migration Plan V2: CoFHE SDK to Zama FHEVM Relayer SDK

## Executive Summary

This document outlines the complete migration of the EVVM frontend from the deprecated `@cofhe/sdk` (Fhenix) to `@zama-fhe/relayer-sdk` (Zama FHEVM).

**Target SDK**: `@zama-fhe/relayer-sdk` (latest from npm)

**Migration Approach**: 
1. **Phase A (Demo-First)**: Use `publicDecrypt()` for decryption (current contracts use `makePubliclyDecryptable()`)
2. **Phase B (Privacy-First)**: Modify contracts to use `FHE.allow()` and use `userDecrypt()` with EIP-712 signing

---

## Table of Contents

1. [Critical SDK Differences](#critical-sdk-differences)
2. [Privacy Architecture Analysis](#privacy-architecture-analysis)
3. [Files Inventory](#files-inventory)
4. [Phase 1: Dependencies](#phase-1-dependencies)
5. [Phase 2: Core Hooks](#phase-2-core-hooks)
6. [Phase 3: Page Updates](#phase-3-page-updates)
7. [Phase 4: Cleanup](#phase-4-cleanup)
8. [Happy Path: EVVMCafe Flow](#happy-path-evvmcafe-flow)
9. [Testing Checklist](#testing-checklist)

---

## Critical SDK Differences

### 1. Encryption Output Format

**CoFHE SDK** returns opaque encrypted values directly usable in contract calls:
```typescript
const encrypted = await onEncryptInput(FheTypes.Uint64, balance);
// encrypted is directly passed to contract
await contract.registerAccount(vaddr, encrypted);
```

**Zama Relayer SDK** returns `Uint8Array` buffers that MUST be converted to hex:
```typescript
// Result from Zama SDK
type EncryptResult = {
  handles: Uint8Array[];  // NOT hex strings!
  inputProof: Uint8Array; // NOT hex string!
};

// MUST convert to hex for contract calls
const toHex = (value: Uint8Array): `0x${string}` => 
  ("0x" + Buffer.from(value).toString("hex")) as `0x${string}`;

const encrypted = await buffer.encrypt();
await contract.registerAccount(
  vaddr,
  toHex(encrypted.handles[0]),  // Convert handle
  toHex(encrypted.inputProof)   // Convert proof
);
```

### 2. Initialization

**CoFHE SDK**:
```typescript
import { createCofhesdkClient, createCofhesdkConfig } from "@cofhe/sdk/web";
const config = createCofhesdkConfig({ supportedChains: [sepolia] });
const client = createCofhesdkClient(config);
await client.connect(publicClient, walletClient);
```

**Zama Relayer SDK**:
```typescript
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
const instance = await createInstance(SepoliaConfig);
// No explicit connect needed - instance is ready
```

### 3. Encryption API

**CoFHE SDK**:
```typescript
const encrypted = await onEncryptInput(FheTypes.Uint64, value);
```

**Zama Relayer SDK**:
```typescript
const buffer = instance.createEncryptedInput(contractAddress, userAddress);
buffer.add64(BigInt(value));
const { handles, inputProof } = await buffer.encrypt();
```

### 4. Decryption API

**CoFHE SDK** (permit-based):
```typescript
await createPermit({ type: "self", issuer: address });
const result = await client.decryptHandle(handle, FheTypes.Uint64).decrypt();
```

**Zama Relayer SDK** (two modes):

**Public Decryption** (for `makePubliclyDecryptable()` values - DEMO MODE):
```typescript
const clearValue = await instance.publicDecrypt(handle);
```

**User Decryption** (for `FHE.allow()` values - PRIVACY MODE):
```typescript
const keypair = instance.generateKeypair();
const eip712 = instance.createEIP712(publicKey, contracts, timestamp, duration);
const signature = await wallet.signTypedData(eip712);
const result = await instance.userDecrypt(handles, keypair, signature, ...);
```

---

## Privacy Architecture Analysis

### Current State: NO PRIVACY

The deployed contracts use `FHE.makePubliclyDecryptable()` on ALL balances and amounts:

| Location | Line | Issue |
|----------|------|-------|
| `registerAccount()` | 332 | `FHE.makePubliclyDecryptable(balance)` |
| `_applyTransferInternal()` | 424 | `FHE.makePubliclyDecryptable(amountEnc)` |
| `_applyTransferInternal()` | 439-440 | `FHE.makePubliclyDecryptable(newFromBalance/newToBalance)` |
| + 10 more locations | Various | All amounts/balances made public |

**Result**: Anyone can call `publicDecrypt()` on any encrypted value. This is NOT private.

### Target State: FULL PRIVACY (Phase B)

Replace all `makePubliclyDecryptable()` with:
```solidity
FHE.allow(balance, userAddress);  // Only owner can decrypt
// DO NOT call makePubliclyDecryptable()
```

Frontend would then use `userDecrypt()` with EIP-712 signing.

### Migration Strategy

1. **Phase A (This Migration)**: Use `publicDecrypt()` - works with current contracts
2. **Phase B (Future)**: Modify contracts + use `userDecrypt()` for true privacy

---

## Files Inventory

### Files to CREATE

| File | Purpose |
|------|---------|
| `app/hooks/useZamaFhevm.ts` | FHEVM instance management + React context |
| `app/hooks/useEncrypt.ts` | Encryption with Uint8Array->hex conversion |
| `app/hooks/useDecrypt.ts` | Public decryption (demo) + User decryption (future) |

### Files to UPDATE

| File | Changes |
|------|---------|
| `app/evvm-cafe/page.tsx` | Replace CoFHE hooks with Zama hooks |
| `app/FHECounterComponent.tsx` | Replace CoFHE hooks with Zama hooks |
| `app/page.tsx` | Update branding (CoFHE -> Zama FHEVM) |
| `components/ScaffoldEthAppWithProviders.tsx` | Replace CoFHE provider with Zama provider |
| `components/scaffold-eth/EncryptedValueCard.tsx` | Update decryption logic |

### Files to DELETE

| File | Reason |
|------|--------|
| `app/useCofhe.ts` | Replaced by `useZamaFhevm.ts` |
| `app/useEncryptInput.ts` | Replaced by `useEncrypt.ts` |
| `app/useDecrypt.ts` | Replaced by new `useDecrypt.ts` |
| `components/cofhe/CofhePortal.tsx` | Permit system not needed |
| `components/cofhe/CofhePermitModal.tsx` | Permit system not needed |
| `utils/cofhe/logging.ts` | CoFHE-specific logging |

---

## Phase 1: Dependencies

### 1.1 Update package.json

```bash
cd packages/nextjs

# Remove CoFHE SDK
yarn remove @cofhe/sdk

# Add Zama Relayer SDK
yarn add @zama-fhe/relayer-sdk
```

### 1.2 Verify Installation

```bash
# Check installed version
yarn list @zama-fhe/relayer-sdk
```

---

## Phase 2: Core Hooks

### 2.1 Create `app/hooks/useZamaFhevm.ts`

```typescript
"use client";

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from "react";
import { createInstance, FhevmInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import { useAccount } from "wagmi";

// Singleton instance management
let fhevmInstance: FhevmInstance | null = null;
let instancePromise: Promise<FhevmInstance> | null = null;

interface ZamaFhevmContextType {
  instance: FhevmInstance | null;
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  reinitialize: () => Promise<void>;
}

const ZamaFhevmContext = createContext<ZamaFhevmContextType>({
  instance: null,
  isInitialized: false,
  isInitializing: false,
  error: null,
  reinitialize: async () => {},
});

export const useZamaFhevm = () => useContext(ZamaFhevmContext);

async function getOrCreateInstance(): Promise<FhevmInstance> {
  if (fhevmInstance) return fhevmInstance;
  if (instancePromise) return instancePromise;

  instancePromise = createInstance(SepoliaConfig);
  fhevmInstance = await instancePromise;
  instancePromise = null;
  return fhevmInstance;
}

export function ZamaFhevmProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isConnected, chainId } = useAccount();

  const initialize = useCallback(async () => {
    // Only initialize on Sepolia (chainId 11155111)
    if (chainId !== 11155111) {
      setError("Please connect to Sepolia network for FHE features");
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      const inst = await getOrCreateInstance();
      setInstance(inst);
      console.log("FHEVM initialized successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize FHEVM";
      setError(message);
      console.error("FHEVM initialization error:", err);
    } finally {
      setIsInitializing(false);
    }
  }, [chainId]);

  const reinitialize = useCallback(async () => {
    fhevmInstance = null;
    instancePromise = null;
    await initialize();
  }, [initialize]);

  useEffect(() => {
    if (isConnected && chainId === 11155111) {
      initialize();
    }
  }, [isConnected, chainId, initialize]);

  return (
    <ZamaFhevmContext.Provider
      value={{
        instance,
        isInitialized: !!instance,
        isInitializing,
        error,
        reinitialize,
      }}
    >
      {children}
    </ZamaFhevmContext.Provider>
  );
}

// Helper hooks
export function useIsFhevmReady(): boolean {
  const { isInitialized, error } = useZamaFhevm();
  return isInitialized && !error;
}

export function useFhevmInstance(): FhevmInstance {
  const { instance } = useZamaFhevm();
  if (!instance) {
    throw new Error("FHEVM not initialized. Wrap your app in ZamaFhevmProvider.");
  }
  return instance;
}
```

### 2.2 Create `app/hooks/useEncrypt.ts`

```typescript
"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useZamaFhevm } from "./useZamaFhevm";

// Convert Uint8Array to hex string for contract calls
export const toHex = (value: Uint8Array): `0x${string}` =>
  ("0x" + Buffer.from(value).toString("hex")) as `0x${string}`;

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
  encrypt: (contractAddress: string, values: EncryptValueType[]) => Promise<EncryptedInput | null>;
  encryptUint64: (contractAddress: string, value: bigint) => Promise<EncryptedInput | null>;
  encryptUint32: (contractAddress: string, value: bigint) => Promise<EncryptedInput | null>;
  isEncrypting: boolean;
  error: string | null;
  encryptionDisabled: boolean;
}

export function useEncrypt(): UseEncryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const { address } = useAccount();
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encrypt = useCallback(
    async (contractAddress: string, values: EncryptValueType[]): Promise<EncryptedInput | null> => {
      if (!instance || !isInitialized) {
        setError("FHEVM not initialized");
        return null;
      }

      if (!address) {
        setError("Wallet not connected");
        return null;
      }

      setIsEncrypting(true);
      setError(null);

      try {
        // Create encrypted input buffer bound to contract and user
        const buffer = instance.createEncryptedInput(contractAddress, address);

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

        // Convert Uint8Array to hex strings for contract calls
        return {
          handles: result.handles.map(toHex),
          inputProof: toHex(result.inputProof),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Encryption failed";
        setError(message);
        console.error("Encryption error:", err);
        return null;
      } finally {
        setIsEncrypting(false);
      }
    },
    [instance, isInitialized, address]
  );

  // Convenience methods
  const encryptUint64 = useCallback(
    (contractAddress: string, value: bigint) => encrypt(contractAddress, [{ type: "uint64", value }]),
    [encrypt]
  );

  const encryptUint32 = useCallback(
    (contractAddress: string, value: bigint) => encrypt(contractAddress, [{ type: "uint32", value }]),
    [encrypt]
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
```

### 2.3 Create `app/hooks/useDecrypt.ts`

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useZamaFhevm } from "./useZamaFhevm";

export type DecryptionState = "idle" | "pending" | "success" | "error" | "no-data" | "encrypted";

export interface DecryptResult {
  value: bigint | boolean | string | null;
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
        return 0n;
      }

      setIsDecrypting(true);
      setError(null);

      try {
        // Public decryption - works for makePubliclyDecryptable() values
        const result = await instance.publicDecrypt(handleBigInt);
        return BigInt(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Decryption failed";
        setError(message);
        console.error("Public decryption error:", err);
        return null;
      } finally {
        setIsDecrypting(false);
      }
    },
    [instance, isInitialized]
  );

  return { decrypt, isDecrypting, error };
}

/**
 * Hook for reactive decryption with state management
 * 
 * Use this in components that need to display encrypted values
 * and allow users to trigger decryption
 */
export function useDecryptValue(
  ctHash: bigint | null | undefined
): DecryptResult & { onDecrypt: () => Promise<void> } {
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
 * Requires EIP-712 signature from user each time
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
        // Generate keypair for this decryption session
        const keypair = instance.generateKeypair();

        // Create EIP-712 signature request
        const startTimestamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = "10";

        const eip712 = instance.createEIP712(
          keypair.publicKey,
          [contractAddress],
          startTimestamp,
          durationDays
        );

        // User signs the request
        const signature = await walletClient.signTypedData({
          domain: eip712.domain as any,
          types: eip712.types as any,
          primaryType: "UserDecryptRequestVerification",
          message: eip712.message as any,
        });

        // Perform user decryption
        const result = await instance.userDecrypt(
          [{ handle: handleBigInt.toString(), contractAddress }],
          keypair.privateKey,
          keypair.publicKey,
          signature.replace("0x", ""),
          [contractAddress],
          address,
          startTimestamp,
          durationDays
        );

        const decryptedValue = result[handleBigInt.toString()];
        return decryptedValue !== undefined ? BigInt(decryptedValue) : null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "User decryption failed";
        setError(message);
        console.error("User decryption error:", err);
        return null;
      } finally {
        setIsDecrypting(false);
      }
    },
    [instance, isInitialized, address, walletClient]
  );

  return { decrypt, isDecrypting, error };
}
```

---

## Phase 3: Page Updates

### 3.1 Update `components/ScaffoldEthAppWithProviders.tsx`

**Changes:**
- Remove `useConnectCofheClient` import and usage
- Remove `CofhePermitModal` import and usage
- Add `ZamaFhevmProvider` wrapper

```typescript
"use client";

import { useEffect, useState } from "react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
import { WagmiProvider } from "wagmi";
import { ZamaFhevmProvider } from "~~/app/hooks/useZamaFhevm";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { useInitializeNativeCurrencyPrice } from "~~/hooks/scaffold-eth";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  useInitializeNativeCurrencyPrice();

  return (
    <>
      <div className={`flex flex-col min-h-screen`}>
        <Header />
        <main className="relative flex flex-col flex-1">{children}</main>
        <Footer />
      </div>
      <Toaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ProgressBar height="3px" color="#2299dd" />
        <RainbowKitProvider
          avatar={BlockieAvatar}
          theme={mounted ? (isDarkMode ? darkTheme() : lightTheme()) : lightTheme()}
        >
          <ZamaFhevmProvider>
            <ScaffoldEthApp>{children}</ScaffoldEthApp>
          </ZamaFhevmProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
```

### 3.2 Update `app/evvm-cafe/page.tsx`

**Key Changes:**
- Replace `useEncryptInput` with `useEncrypt`
- Replace `useDecryptValue` with new hook
- Remove all permit-related code
- Update function signatures for Zama SDK

See full implementation in Phase 3 execution.

### 3.3 Update `app/FHECounterComponent.tsx`

**Key Changes:**
- Replace `FheTypes.Uint32` with `{ type: "uint32", value }`
- Update encryption call to use `encryptUint32`
- Update contract call to pass `handles[0]` and `inputProof` separately

### 3.4 Update `components/scaffold-eth/EncryptedValueCard.tsx`

**Key Changes:**
- Remove FheTypes dependency
- Update to use new `useDecryptValue` hook
- Simplify decryption flow (no permits needed)

---

## Phase 4: Cleanup

### 4.1 Files to Delete

```bash
# Delete CoFHE-specific files
rm packages/nextjs/app/useCofhe.ts
rm packages/nextjs/app/useEncryptInput.ts
rm packages/nextjs/app/useDecrypt.ts
rm -rf packages/nextjs/components/cofhe/
rm packages/nextjs/utils/cofhe/logging.ts
```

### 4.2 Remove CoFHE from package.json

```bash
cd packages/nextjs
yarn remove @cofhe/sdk
```

---

## Happy Path: EVVMCafe Flow

### 1. User Registration

```typescript
const { encryptUint64 } = useEncrypt();
const { data: evvmCoreContract } = useDeployedContractInfo({ contractName: "EVVMCore" });

const handleRegister = async () => {
  const balance = BigInt(initialBalance);
  const encrypted = await encryptUint64(evvmCoreContract.address, balance);
  
  if (!encrypted) return;
  
  await writeEVVMCore({
    functionName: "registerAccountFromAddress",
    args: [address, encrypted.handles[0], encrypted.inputProof],
  });
};
```

### 2. Shop Registration

```typescript
const handleRegisterShop = async () => {
  const encrypted = await encryptUint64(evvmCoreContract.address, 0n);
  
  if (!encrypted) return;
  
  await writeEVVMCore({
    functionName: "registerAccountFromAddress",
    args: [evvmCafeContract.address, encrypted.handles[0], encrypted.inputProof],
  });
};
```

### 3. Order Coffee (Payment)

```typescript
const handleOrderCoffee = async () => {
  const totalPrice = coffeePrice * BigInt(quantity);
  const encrypted = await encryptUint64(evvmCoreContract.address, totalPrice);
  
  if (!encrypted) return;
  
  // Step 1: Process payment
  await writeEVVMCore({
    functionName: "requestPay",
    args: [
      address,                    // from
      evvmCafeContract.address,   // to (shop)
      encrypted.handles[0],       // encrypted amount
      encrypted.inputProof,       // proof
      evvmNonce,                  // nonce
    ],
  });
  
  // Step 2: Register order
  await writeEVVMCafe({
    functionName: "orderCoffee",
    args: [address, coffeeType, BigInt(quantity), paymentTxId, serviceNonce, evvmNonce],
  });
};
```

### 4. View Balance (Public Decryption - Demo)

```typescript
const { onDecrypt, value, state } = useDecryptValue(clientBalanceEnc);

// In UI
{state === "encrypted" && (
  <button onClick={onDecrypt}>Decrypt Balance</button>
)}
{state === "success" && (
  <span>{value?.toString()} tokens</span>
)}
```

---

## Testing Checklist

### Unit Tests

- [ ] `useZamaFhevm` initializes on Sepolia
- [ ] `useZamaFhevm` shows error on wrong network
- [ ] `useEncrypt` encrypts values correctly
- [ ] `useEncrypt` converts Uint8Array to hex
- [ ] `usePublicDecrypt` decrypts public values
- [ ] `useDecryptValue` manages state correctly

### Integration Tests (Sepolia)

- [ ] Register client with encrypted balance
- [ ] Register shop with zero balance
- [ ] Process encrypted payment
- [ ] Decrypt balance shows correct value
- [ ] Multiple transactions work correctly
- [ ] Nonce increments properly

### E2E Flow

1. [ ] Connect wallet to Sepolia
2. [ ] FHEVM initializes automatically
3. [ ] Register client account
4. [ ] Register shop (if not registered)
5. [ ] Order coffee with encrypted payment
6. [ ] View decrypted balances

---

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| **EVVMCore** | `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50` |
| **EVVMCafe** | `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc` |

---

## References

- [Zama Relayer SDK GitHub](https://github.com/zama-ai/relayer-sdk)
- [Zama Protocol Docs](https://docs.zama.ai/protocol)
- [Zama Sepolia Config](https://docs.zama.ai/protocol/solidity-guides/smart-contract/configure/contract_addresses)
- [EVVMCore Contract Source](../../../packages/hardhat/contracts/core/EVVM.core.sol)

---

## Appendix: Quick Migration Cheatsheet

| CoFHE Pattern | Zama Pattern |
|---------------|--------------|
| `FheTypes.Uint64` | `{ type: "uint64", value }` |
| `onEncryptInput(FheTypes.Uint64, val)` | `encryptUint64(contractAddr, val)` |
| `result` (direct use) | `{ handles[0], inputProof }` |
| `createPermit(...)` | Not needed |
| `useDecryptValue(FheTypes.Uint64, hash)` | `useDecryptValue(hash)` |
| `cofheConnected` | `isInitialized` from `useZamaFhevm()` |
| `inputEncryptionDisabled` | `encryptionDisabled` from `useEncrypt()` |
