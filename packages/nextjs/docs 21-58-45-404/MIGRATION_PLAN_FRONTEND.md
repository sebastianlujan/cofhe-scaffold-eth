# Frontend Migration Plan: CoFHE SDK → Zama FHEVM Relayer SDK

## Executive Summary

This document outlines the migration of the EVVM frontend from the deprecated `@cofhe/sdk` (Fhenix) to `@zama-fhe/relayer-sdk` (Zama FHEVM) for full compatibility with the deployed Sepolia contracts.

**Target SDK Version:** `@zama-fhe/relayer-sdk@0.3.0-5`

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Architecture Comparison](#architecture-comparison)
3. [Files to Migrate](#files-to-migrate)
4. [Phase 1: Dependencies & Configuration](#phase-1-dependencies--configuration)
5. [Phase 2: Core FHEVM Instance Hook](#phase-2-core-fhevm-instance-hook)
6. [Phase 3: Encryption Hook Migration](#phase-3-encryption-hook-migration)
7. [Phase 4: Decryption Hook Migration](#phase-4-decryption-hook-migration)
8. [Phase 5: EVVM Cafe Page Update](#phase-5-evvm-cafe-page-update)
9. [Phase 6: Cleanup](#phase-6-cleanup)
10. [Gasless Payment Integration](#gasless-payment-integration)
11. [Testing Checklist](#testing-checklist)
12. [Risk Assessment](#risk-assessment)

---

## Current State Analysis

### Deployed Contracts (Sepolia)

| Contract | Address | SDK Used |
|----------|---------|----------|
| **EVVMCore** | `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50` | `@fhevm/solidity` (Zama) |
| **EVVMCafe** | `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc` | `@fhevm/solidity` (Zama) |

### Current Frontend Dependencies

```json
{
  "@cofhe/sdk": "x.x.x"  // DEPRECATED - Fhenix SDK
}
```

### Target Frontend Dependencies

```json
{
  "@zama-fhe/relayer-sdk": "0.3.0-5"  // Zama FHEVM Relayer SDK
}
```

### Incompatibility Issue

The contracts use **Zama FHEVM** (`@fhevm/solidity`) but the frontend uses **Fhenix CoFHE** (`@cofhe/sdk`). These are different FHE systems with incompatible:
- Encryption schemes
- Key management
- Proof formats
- Decryption mechanisms

**This migration is REQUIRED for the frontend to work with the deployed contracts.**

---

## Architecture Comparison

### Encryption Flow Comparison

| Aspect | CoFHE (Current) | Zama FHEVM (Target) |
|--------|-----------------|---------------------|
| **SDK Import** | `@cofhe/sdk` | `@zama-fhe/relayer-sdk` |
| **Initialization** | `createCofhesdkConfig()` | `createInstance(SepoliaConfig)` |
| **Input Creation** | Per-value with type enum | Buffer-based batching |
| **Contract Binding** | Implicit via permits | Explicit `(contractAddr, userAddr)` |
| **Output Format** | Opaque encrypted value | `{ handles[], inputProof }` |
| **Proof Type** | CoFHE permit system | Zama input verification proof |

### Decryption Flow Comparison

| Aspect | CoFHE (Current) | Zama FHEVM (Target) |
|--------|-----------------|---------------------|
| **Auth Method** | Stored permits | EIP-712 signatures |
| **Key Management** | SDK internal | User generates NaCl keypair |
| **Decryption** | `useDecryptValue()` hook | `instance.userDecrypt()` |
| **Privacy Model** | Server-assisted | Client-side NaCl decryption |
| **Permit Storage** | LocalStorage | Not needed (per-request signing) |

---

## Files to Migrate

### Files to Replace

| Current File | New File | Action |
|--------------|----------|--------|
| `app/useCofhe.ts` | `app/hooks/useZamaFhevm.ts` | **REPLACE** - New Zama instance management |
| `app/useEncryptInput.ts` | `app/hooks/useEncrypt.ts` | **REWRITE** - New encryption API |
| `app/useDecrypt.ts` | `app/hooks/useDecrypt.ts` | **REWRITE** - New decryption API |

### Files to Remove

| File | Reason |
|------|--------|
| `components/cofhe/CofhePortal.tsx` | Permit management not needed |
| `components/cofhe/CofhePermitModal.tsx` | Permit creation not needed |

### Files to Update

| File | Changes |
|------|---------|
| `app/evvm-cafe/page.tsx` | Update imports, encryption/decryption calls |
| `components/ScaffoldEthAppWithProviders.tsx` | Remove CoFHE provider, add Zama provider |
| `scaffold.config.ts` | No changes needed (Sepolia already configured) |

---

## Phase 1: Dependencies & Configuration

### 1.1 Update package.json

```bash
cd packages/nextjs
yarn remove @cofhe/sdk
yarn add @zama-fhe/relayer-sdk@0.3.0-5
```

### 1.2 Verify Sepolia Configuration

The Zama Sepolia configuration is available via `SepoliaConfig`:

```typescript
import { SepoliaConfig } from '@zama-fhe/relayer-sdk';

// SepoliaConfig contains:
// - aclContractAddress: '0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D'
// - kmsContractAddress: '0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A'
// - inputVerifierContractAddress: '0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0'
// - chainId: 11155111
// - gatewayChainId: 10901
// - relayerUrl: 'https://relayer.testnet.zama.org'
```

### 1.3 Environment Variables

No additional environment variables required - SepoliaConfig contains all necessary addresses.

**Estimated Time:** 30 minutes

---

## Phase 2: Core FHEVM Instance Hook

### 2.1 Create `app/hooks/useZamaFhevm.ts`

```typescript
"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { createInstance, FhevmInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import { useAccount, useWalletClient } from "wagmi";

// Singleton instance
let fhevmInstance: FhevmInstance | null = null;
let instancePromise: Promise<FhevmInstance> | null = null;

// Context for sharing instance across components
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

// Get or create singleton instance
async function getOrCreateInstance(): Promise<FhevmInstance> {
  if (fhevmInstance) {
    return fhevmInstance;
  }

  if (instancePromise) {
    return instancePromise;
  }

  instancePromise = createInstance(SepoliaConfig);
  fhevmInstance = await instancePromise;
  instancePromise = null;
  
  return fhevmInstance;
}

// Provider component
export function ZamaFhevmProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<FhevmInstance | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isConnected, chainId } = useAccount();

  const initialize = useCallback(async () => {
    // Only initialize on Sepolia
    if (chainId !== 11155111) {
      setError("Please connect to Sepolia network");
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      const inst = await getOrCreateInstance();
      setInstance(inst);
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

// Hook to check if FHEVM is ready
export function useIsFhevmReady(): boolean {
  const { isInitialized, error } = useZamaFhevm();
  return isInitialized && !error;
}

// Hook to get FHEVM instance (throws if not ready)
export function useFhevmInstance(): FhevmInstance {
  const { instance } = useZamaFhevm();
  if (!instance) {
    throw new Error("FHEVM instance not initialized. Wrap your app in ZamaFhevmProvider.");
  }
  return instance;
}
```

**Estimated Time:** 1 hour

---

## Phase 3: Encryption Hook Migration

### 3.1 Create `app/hooks/useEncrypt.ts`

```typescript
"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useZamaFhevm } from "./useZamaFhevm";

export interface EncryptedInput {
  handles: `0x${string}`[];
  inputProof: `0x${string}`;
}

export interface UseEncryptResult {
  encrypt: (contractAddress: string, values: EncryptValue[]) => Promise<EncryptedInput | null>;
  encryptUint64: (contractAddress: string, value: bigint) => Promise<EncryptedInput | null>;
  isEncrypting: boolean;
  error: string | null;
}

export type EncryptValue =
  | { type: "bool"; value: boolean }
  | { type: "uint8"; value: bigint }
  | { type: "uint16"; value: bigint }
  | { type: "uint32"; value: bigint }
  | { type: "uint64"; value: bigint }
  | { type: "uint128"; value: bigint }
  | { type: "uint256"; value: bigint }
  | { type: "address"; value: string };

export function useEncrypt(): UseEncryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const { address } = useAccount();
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encrypt = useCallback(
    async (contractAddress: string, values: EncryptValue[]): Promise<EncryptedInput | null> => {
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
        // Create encrypted input buffer
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

        // Encrypt and upload to relayer
        const result = await buffer.encrypt();

        return {
          handles: result.handles as `0x${string}`[],
          inputProof: result.inputProof as `0x${string}`,
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

  // Convenience method for encrypting a single uint64
  const encryptUint64 = useCallback(
    async (contractAddress: string, value: bigint): Promise<EncryptedInput | null> => {
      return encrypt(contractAddress, [{ type: "uint64", value }]);
    },
    [encrypt]
  );

  return {
    encrypt,
    encryptUint64,
    isEncrypting,
    error,
  };
}
```

### 3.2 Usage Example (Before vs After)

**Before (CoFHE):**
```typescript
const { onEncryptInput } = useEncryptInput();
const encrypted = await onEncryptInput(FheTypes.Uint64, balance);
await contract.registerAccount(vaddr, encrypted);
```

**After (Zama):**
```typescript
const { encryptUint64 } = useEncrypt();
const encrypted = await encryptUint64(contractAddress, balance);
await contract.registerAccount(vaddr, encrypted.handles[0], encrypted.inputProof);
```

**Estimated Time:** 1 hour

---

## Phase 4: Decryption Hook Migration

### 4.1 Create `app/hooks/useDecrypt.ts`

```typescript
"use client";

import { useState, useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useZamaFhevm } from "./useZamaFhevm";

export interface DecryptResult {
  value: bigint | boolean | string | null;
  state: "idle" | "pending" | "success" | "error";
  error: string | null;
}

export interface UseUserDecryptResult {
  decrypt: (handle: string, contractAddress: string) => Promise<bigint | boolean | string | null>;
  decryptMultiple: (
    handles: { handle: string; contractAddress: string }[]
  ) => Promise<Record<string, bigint | boolean | string>>;
  isDecrypting: boolean;
  error: string | null;
}

export function useUserDecrypt(): UseUserDecryptResult {
  const { instance, isInitialized } = useZamaFhevm();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decryptMultiple = useCallback(
    async (
      handles: { handle: string; contractAddress: string }[]
    ): Promise<Record<string, bigint | boolean | string>> => {
      if (!instance || !isInitialized) {
        setError("FHEVM not initialized");
        return {};
      }

      if (!address || !walletClient) {
        setError("Wallet not connected");
        return {};
      }

      setIsDecrypting(true);
      setError(null);

      try {
        // Generate keypair for this decryption session
        const keypair = instance.generateKeypair();

        // Get unique contract addresses
        const contractAddresses = [...new Set(handles.map((h) => h.contractAddress))];

        // Create EIP-712 signature request
        const startTimestamp = Math.floor(Date.now() / 1000).toString();
        const durationDays = "10"; // Valid for 10 days

        const eip712 = instance.createEIP712(
          keypair.publicKey,
          contractAddresses,
          startTimestamp,
          durationDays
        );

        // User signs the request
        const signature = await walletClient.signTypedData({
          domain: eip712.domain,
          types: { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
          primaryType: "UserDecryptRequestVerification",
          message: eip712.message,
        });

        // Format handles for the API
        const handleContractPairs = handles.map((h) => ({
          handle: h.handle,
          contractAddress: h.contractAddress,
        }));

        // Perform user decryption
        const result = await instance.userDecrypt(
          handleContractPairs,
          keypair.privateKey,
          keypair.publicKey,
          signature.replace("0x", ""),
          contractAddresses,
          address,
          startTimestamp,
          durationDays
        );

        return result as Record<string, bigint | boolean | string>;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Decryption failed";
        setError(message);
        console.error("Decryption error:", err);
        return {};
      } finally {
        setIsDecrypting(false);
      }
    },
    [instance, isInitialized, address, walletClient]
  );

  // Convenience method for single value decryption
  const decrypt = useCallback(
    async (handle: string, contractAddress: string): Promise<bigint | boolean | string | null> => {
      const result = await decryptMultiple([{ handle, contractAddress }]);
      return result[handle] ?? null;
    },
    [decryptMultiple]
  );

  return {
    decrypt,
    decryptMultiple,
    isDecrypting,
    error,
  };
}

// Hook for reactive decryption state
export function useDecryptValue(handle: string | null, contractAddress: string): DecryptResult & { onDecrypt: () => void } {
  const { decrypt, isDecrypting, error } = useUserDecrypt();
  const [value, setValue] = useState<bigint | boolean | string | null>(null);
  const [state, setState] = useState<DecryptResult["state"]>("idle");

  const onDecrypt = useCallback(async () => {
    if (!handle || handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      setState("error");
      return;
    }

    setState("pending");
    const result = await decrypt(handle, contractAddress);

    if (result !== null) {
      setValue(result);
      setState("success");
    } else {
      setState("error");
    }
  }, [handle, contractAddress, decrypt]);

  return {
    value,
    state: isDecrypting ? "pending" : state,
    error,
    onDecrypt,
  };
}
```

### 4.2 Usage Example (Before vs After)

**Before (CoFHE):**
```typescript
const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, encHandle);
// Requires permit to be created first
await onDecrypt();
console.log(result.value);
```

**After (Zama):**
```typescript
const { decrypt } = useUserDecrypt();
// User signs EIP-712 request, no permit storage needed
const value = await decrypt(encHandle, contractAddress);
console.log(value);
```

**Estimated Time:** 1.5 hours

---

## Phase 5: EVVM Cafe Page Update

### 5.1 Update Imports

```diff
- import { useEncryptInput } from "~~/app/useEncryptInput";
- import { useDecryptValue } from "~~/app/useDecrypt";
- import { useCofheConnected, useCofheCreatePermit, useCofheIsActivePermitValid } from "~~/app/useCofhe";
- import { FheTypes } from "@cofhe/sdk";
+ import { useEncrypt } from "~~/app/hooks/useEncrypt";
+ import { useUserDecrypt, useDecryptValue } from "~~/app/hooks/useDecrypt";
+ import { useZamaFhevm, useIsFhevmReady } from "~~/app/hooks/useZamaFhevm";
```

### 5.2 Update Registration Flow

```typescript
// Old CoFHE flow
const handleRegisterClient = async () => {
  const encryptedBalance = await onEncryptInput(FheTypes.Uint64, balance);
  await writeEVVMCore({
    functionName: "registerAccountFromAddress",
    args: [address, encryptedBalance],
  });
};

// New Zama flow
const handleRegisterClient = async () => {
  const encrypted = await encryptUint64(evvmCoreAddress, BigInt(initialBalance));
  if (!encrypted) return;
  
  await writeEVVMCore({
    functionName: "registerAccountFromAddress",
    args: [address, encrypted.handles[0], encrypted.inputProof],
  });
};
```

### 5.3 Update Payment Flow

```typescript
// Old CoFHE flow
const handleOrderCoffee = async () => {
  await createPermit({ type: "sharing", issuer: address, recipient: evvmCoreAddress });
  const encryptedPrice = await onEncryptInput(FheTypes.Uint64, totalPrice);
  await writeEVVMCore({
    functionName: "requestPay",
    args: [address, shopAddress, encryptedPrice, evvmNonce],
  });
};

// New Zama flow
const handleOrderCoffee = async () => {
  const encrypted = await encryptUint64(evvmCoreAddress, totalPrice);
  if (!encrypted) return;
  
  await writeEVVMCore({
    functionName: "requestPay",
    args: [address, shopAddress, encrypted.handles[0], encrypted.inputProof, evvmNonce],
  });
};
```

### 5.4 Update Balance Viewing

```typescript
// Old CoFHE flow
const { onDecrypt: onDecryptBalance, result } = useDecryptValue(
  FheTypes.Uint64,
  clientBalanceEnc
);
// Requires creating permit first

// New Zama flow
const { value: clientBalance, state, onDecrypt } = useDecryptValue(
  clientBalanceEnc?.toString() ?? null,
  evvmCoreAddress
);
// User signs EIP-712 when clicking decrypt
```

### 5.5 Remove Permit UI

Remove all permit-related UI components:
- "Create Permit" buttons
- Permit status indicators
- `hasActivePermit` checks

**Estimated Time:** 1.5 hours

---

## Phase 6: Cleanup

### 6.1 Files to Remove

```bash
rm packages/nextjs/app/useCofhe.ts
rm packages/nextjs/app/useEncryptInput.ts
rm packages/nextjs/app/useDecrypt.ts
rm -rf packages/nextjs/components/cofhe/
```

### 6.2 Update ScaffoldEthAppWithProviders.tsx

```diff
- import { useConnectCofheClient } from "~~/app/useCofhe";
+ import { ZamaFhevmProvider } from "~~/app/hooks/useZamaFhevm";

export const ScaffoldEthAppWithProviders = ({ children }) => {
  return (
    <WagmiProvider>
      <QueryClientProvider>
        <RainbowKitProvider>
+         <ZamaFhevmProvider>
            {children}
+         </ZamaFhevmProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
```

### 6.3 Remove Unused Imports Throughout Codebase

Search and remove all references to:
- `@cofhe/sdk`
- `useCofhe*`
- `FheTypes`
- `CofhePortal`
- `CofhePermitModal`

**Estimated Time:** 1 hour

---

## Gasless Payment Integration

### Future Enhancement: Relayer-Submitted Transactions

The Zama Relayer architecture supports gasless transactions:

```
User Flow:
1. User encrypts payment → Relayer uploads ciphertext
2. User signs EIP-191 transfer authorization
3. Relayer submits applySignedTransfer() on-chain
4. User pays no gas (Relayer covers it)
```

### Implementation Requirements

1. **Backend Relayer Service**
   - Receives signed transfer requests
   - Validates signatures
   - Submits transactions to blockchain
   - Manages gas funding

2. **Frontend Changes**
   - Create signed transfer instead of direct call
   - Submit signature to backend relayer
   - Poll for transaction confirmation

3. **Contract Support** (Already implemented!)
   - `applySignedTransfer()` in EVVMCore
   - EIP-191 signature validation
   - Nonce-based replay protection

### Gasless Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER DEVICE                              │
├─────────────────────────────────────────────────────────────────┤
│  1. Encrypt payment amount                                       │
│     └─→ Relayer uploads ciphertext, returns handle              │
│                                                                  │
│  2. Create transfer message hash                                 │
│     └─→ keccak256(domain, from, to, amountCommitment, nonce)    │
│                                                                  │
│  3. Sign with EIP-191                                            │
│     └─→ User signs in wallet (no gas!)                          │
│                                                                  │
│  4. Send to backend relayer                                      │
│     └─→ { handle, inputProof, signature, params }               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND RELAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  5. Validate signature                                           │
│                                                                  │
│  6. Submit applySignedTransfer()                                 │
│     └─→ Relayer pays gas                                        │
│                                                                  │
│  7. Return transaction hash to user                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BLOCKCHAIN                                │
├─────────────────────────────────────────────────────────────────┤
│  8. EVVMCore.applySignedTransfer()                               │
│     ├─→ Verify EIP-191 signature                                │
│     ├─→ Verify signer is registered for vaddr                   │
│     ├─→ Import encrypted amount with FHE.fromExternal()         │
│     ├─→ Subtract from sender (encrypted)                        │
│     ├─→ Add to recipient (encrypted)                            │
│     └─→ Increment nonce                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

### Unit Tests

- [ ] `useZamaFhevm` initializes correctly on Sepolia
- [ ] `useZamaFhevm` fails gracefully on wrong network
- [ ] `useEncrypt` encrypts uint64 values correctly
- [ ] `useEncrypt` handles errors gracefully
- [ ] `useUserDecrypt` decrypts values correctly
- [ ] `useUserDecrypt` handles EIP-712 signing

### Integration Tests

- [ ] Registration flow completes successfully
- [ ] Payment flow completes successfully
- [ ] Balance decryption works after registration
- [ ] Multiple sequential payments work correctly
- [ ] Nonce increments after each payment

### E2E Tests (Sepolia)

- [ ] Full registration → payment → check balance flow
- [ ] Error handling for insufficient balance
- [ ] Network switch detection
- [ ] Wallet disconnect handling

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Zama Relayer downtime | High | Medium | Add retry logic, exponential backoff, user-friendly error messages |
| ACL not configured | High | Low | Verify contract allows user to decrypt their balances |
| EIP-712 signing rejected | Medium | Low | Clear UI instructions, fallback to manual flow |
| SDK breaking changes | Medium | Low | Pin version to 0.3.0-5, monitor changelog |
| Keypair generation fails | Medium | Low | Use crypto-secure random, handle WebCrypto errors |
| Large ciphertext uploads | Medium | Medium | Add progress indicators, chunked uploads if needed |

---

## Implementation Timeline

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1** | Dependencies & Configuration | 30 min |
| **Phase 2** | Core FHEVM Instance Hook | 1 hour |
| **Phase 3** | Encryption Hook | 1 hour |
| **Phase 4** | Decryption Hook | 1.5 hours |
| **Phase 5** | EVVM Cafe Page Update | 1.5 hours |
| **Phase 6** | Cleanup & Testing | 1 hour |
| **Total** | | **~6.5 hours** |

---

## Appendix: API Reference

### Zama Relayer SDK - Key Functions

```typescript
// Initialize instance
const instance = await createInstance(SepoliaConfig);

// Create encrypted input
const buffer = instance.createEncryptedInput(contractAddr, userAddr);
buffer.add64(BigInt(1000));
const { handles, inputProof } = await buffer.encrypt();

// User decryption
const keypair = instance.generateKeypair();
const eip712 = instance.createEIP712(publicKey, contracts, timestamp, duration);
// ... sign eip712 with wallet ...
const result = await instance.userDecrypt(handlePairs, privateKey, publicKey, sig, contracts, user, ts, dur);

// Public decryption (for publicly revealed values)
const { clearValues, decryptionProof } = await instance.publicDecrypt(handles);
```

### Contract Function Signatures (EVVMCore)

```solidity
// Registration
function registerAccountFromAddress(
    address ethAddress,
    externalEuint64 initialBalance,
    bytes calldata inputProof
) external;

// Payment
function requestPay(
    address from,
    address to,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce
) external returns (uint256 txId);

// Signed payment (for gasless)
function applySignedTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature calldata sig
) external returns (uint256 txId);
```

---

## References

- [Zama FHEVM Relayer SDK Documentation](https://github.com/zama-ai/dapps/tree/main/packages/fhevm-sdk)
- [Zama Contract Addresses](https://docs.zama.ai/protocol/solidity-guides/smart-contract/configure/contract_addresses)
- [EIP-712 Typed Data Signing](https://eips.ethereum.org/EIPS/eip-712)
- [EVVMCore Contract Source](../../../packages/hardhat/contracts/core/EVVM.core.sol)
