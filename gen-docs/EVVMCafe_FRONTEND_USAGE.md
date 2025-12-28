# EVVMCafe Frontend Usage Guide

This guide explains how to use the CoFHE SDK in the frontend to interact with EVVMCafe and EVVMCore contracts.

## Table of Contents

- [Prerequisites](#prerequisites)
- [CoFHE SDK Setup](#cofhe-sdk-setup)
- [Hooks Overview](#hooks-overview)
- [Complete Examples](#complete-examples)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **CoFHE SDK Initialized**: The SDK must be connected and ready
2. **Wallet Connected**: User must have a connected wallet
3. **Valid Permit**: A valid permit is required for decryption operations
4. **Network Support**: Connected to a supported network (Hardhat, Sepolia, or Arbitrum Sepolia)

## CoFHE SDK Setup

### Initialization

The CoFHE SDK is automatically initialized in `ScaffoldEthAppWithProviders.tsx`:

```typescript
import { useConnectCofheClient } from "~~/app/useCofhe";

// This hook automatically connects CoFHE when wallet/chain changes
useConnectCofheClient();
```

### Connection Status

Check if CoFHE is connected:

```typescript
import { useCofheConnected } from "~~/app/useCofhe";

const connected = useCofheConnected();

if (!connected) {
  // Show message: "Please connect CoFHE"
  // CoFHE Portal button in header will help user connect
}
```

## Hooks Overview

### Encryption Hook

**`useEncryptInput`**: Encrypts user input before sending to smart contracts

```typescript
import { useEncryptInput } from "~~/app/useEncryptInput";
import { FheTypes } from "@cofhe/sdk";

const { onEncryptInput, isEncryptingInput, inputEncryptionDisabled } = useEncryptInput();

// Encrypt a uint64 value
const encryptedValue = await onEncryptInput(FheTypes.Uint64, 100n);

// Encrypt a uint32 value
const encryptedValue = await onEncryptInput(FheTypes.Uint32, 42);
```

**Parameters**:
- `fheType`: The FHE type (`FheTypes.Uint64`, `FheTypes.Uint32`, etc.)
- `value`: The plaintext value to encrypt (string, bigint, or number)

**Returns**:
- `onEncryptInput`: Async function to encrypt values
- `isEncryptingInput`: Boolean indicating encryption in progress
- `inputEncryptionDisabled`: Boolean indicating if encryption is disabled (CoFHE not connected)

### Decryption Hook

**`useDecryptValue`**: Decrypts encrypted values from smart contracts

```typescript
import { useDecryptValue } from "~~/app/useDecrypt";
import { FheTypes } from "@cofhe/sdk";

// Get encrypted balance from contract
const { data: encryptedBalance } = useScaffoldReadContract({
  contractName: "EVVMCafe",
  functionName: "getShopBalance",
});

// Setup decryption
const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, encryptedBalance);

// Decrypt when user clicks button
const handleDecrypt = async () => {
  await onDecrypt();
  
  if (result.state === "success") {
    console.log("Decrypted value:", result.value);
  }
};
```

**DecryptionResult States**:
- `"no-data"`: No encrypted value provided
- `"encrypted"`: Value is encrypted and ready for decryption
- `"pending"`: Decryption is in progress
- `"success"`: Decryption completed successfully
- `"error"`: Decryption failed

### Contract Interaction Hooks

**`useScaffoldReadContract`**: Read from contracts

```typescript
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const { data: balance } = useScaffoldReadContract({
  contractName: "EVVMCafe",
  functionName: "getCoffeePrice",
  args: ["espresso"],
});
```

**`useScaffoldWriteContract`**: Write to contracts

```typescript
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const { writeContractAsync, isPending } = useScaffoldWriteContract({
  contractName: "EVVMCafe",
});

await writeContractAsync({
  functionName: "orderCoffee",
  args: [/* ... */],
});
```

## Complete Examples

### Example 1: Register Client Account

```typescript
"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useEncryptInput } from "~~/app/useEncryptInput";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { FheTypes } from "@cofhe/sdk";

export const RegisterClientComponent = () => {
  const { address } = useAccount();
  const [initialBalance, setInitialBalance] = useState<string>("1000");
  const { onEncryptInput, isEncryptingInput, inputEncryptionDisabled } = useEncryptInput();
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "EVVMCore",
  });

  const handleRegister = async () => {
    if (!address || !initialBalance) return;

    // Encrypt initial balance
    const encryptedBalance = await onEncryptInput(
      FheTypes.Uint64,
      BigInt(initialBalance)
    );

    if (!encryptedBalance) {
      console.error("Failed to encrypt balance");
      return;
    }

    // Register account
    await writeContractAsync({
      functionName: "registerAccountFromAddress",
      args: [address, encryptedBalance],
    });
  };

  const isLoading = isEncryptingInput || isPending;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="number"
        value={initialBalance}
        onChange={(e) => setInitialBalance(e.target.value)}
        placeholder="Initial balance"
        disabled={isLoading || inputEncryptionDisabled}
      />
      <button
        onClick={handleRegister}
        disabled={isLoading || inputEncryptionDisabled || !initialBalance}
      >
        {isLoading ? "Processing..." : "Register Account"}
      </button>
      {inputEncryptionDisabled && (
        <p className="text-error">CoFHE not connected. Please connect via CoFHE Portal.</p>
      )}
    </div>
  );
};
```

### Example 2: Order Coffee

```typescript
"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { useEncryptInput } from "~~/app/useEncryptInput";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { FheTypes } from "@cofhe/sdk";

export const OrderCoffeeComponent = () => {
  const { address } = useAccount();
  const [coffeeType, setCoffeeType] = useState<string>("espresso");
  const [quantity, setQuantity] = useState<string>("1");
  const [serviceNonce, setServiceNonce] = useState<number>(1);

  const { onEncryptInput, isEncryptingInput, inputEncryptionDisabled } = useEncryptInput();
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "EVVMCafe",
  });

  // Get coffee price
  const { data: price } = useScaffoldReadContract({
    contractName: "EVVMCafe",
    functionName: "getCoffeePrice",
    args: [coffeeType],
  });

  // Get client vaddr
  const { data: clientVaddr } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getVaddrFromAddress",
    args: [address],
  });

  // Get EVVM nonce
  const { data: evvmNonce } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getNonce",
    args: [clientVaddr],
  });

  const handleOrder = useCallback(async () => {
    if (!address || !price || evvmNonce === undefined) return;

    const qty = BigInt(quantity);
    const totalPrice = price * qty;

    // Encrypt total price
    const encryptedPrice = await onEncryptInput(FheTypes.Uint64, totalPrice);

    if (!encryptedPrice) {
      console.error("Failed to encrypt price");
      return;
    }

    // Place order
    await writeContractAsync({
      functionName: "orderCoffee",
      args: [
        address,
        coffeeType,
        qty,
        encryptedPrice,
        BigInt(serviceNonce),
        evvmNonce,
      ],
    });

    // Increment service nonce for next order
    setServiceNonce(prev => prev + 1);
  }, [address, price, quantity, coffeeType, serviceNonce, evvmNonce, onEncryptInput, writeContractAsync]);

  const isLoading = isEncryptingInput || isPending;

  return (
    <div className="flex flex-col gap-4">
      <select
        value={coffeeType}
        onChange={(e) => setCoffeeType(e.target.value)}
        disabled={isLoading}
      >
        <option value="espresso">Espresso (2 tokens)</option>
        <option value="latte">Latte (4 tokens)</option>
        <option value="cappuccino">Cappuccino (4 tokens)</option>
        <option value="americano">Americano (3 tokens)</option>
      </select>

      <input
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="Quantity"
        min="1"
        disabled={isLoading}
      />

      {price && (
        <p>Total Price: {price * BigInt(quantity || "1")} tokens</p>
      )}

      <button
        onClick={handleOrder}
        disabled={isLoading || inputEncryptionDisabled || !address || !price || evvmNonce === undefined}
      >
        {isLoading ? "Processing..." : "Order Coffee"}
      </button>

      {inputEncryptionDisabled && (
        <p className="text-error">CoFHE not connected</p>
      )}
    </div>
  );
};
```

### Example 3: Display Encrypted Balance

```typescript
"use client";

import { useAccount } from "wagmi";
import { useDecryptValue } from "~~/app/useDecrypt";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { FheTypes } from "@cofhe/sdk";
import { EncryptedValue } from "~~/components/scaffold-eth/EncryptedValueCard";

export const BalanceDisplayComponent = () => {
  const { address } = useAccount();

  // Get encrypted balance
  const { data: encryptedBalance } = useScaffoldReadContract({
    contractName: "EVVMCafe",
    functionName: "getClientBalance",
    args: [address],
  });

  // Setup decryption
  const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, encryptedBalance);

  return (
    <div className="flex flex-col gap-2">
      <h3>Your Balance</h3>
      
      {/* Using EncryptedValue component (handles decryption UI automatically) */}
      <EncryptedValue
        fheType={FheTypes.Uint64}
        ctHash={encryptedBalance}
        label="Balance"
      />

      {/* Or manual decryption */}
      <div>
        <button onClick={onDecrypt} disabled={result.state === "pending"}>
          {result.state === "pending" ? "Decrypting..." : "Show Balance"}
        </button>
        
        {result.state === "success" && (
          <p>Balance: {result.value?.toString()} tokens</p>
        )}
        
        {result.state === "error" && (
          <p className="text-error">Error: {result.error}</p>
        )}
      </div>
    </div>
  );
};
```

### Example 4: Register Shop (Owner Only)

```typescript
"use client";

import { useEncryptInput } from "~~/app/useEncryptInput";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { FheTypes } from "@cofhe/sdk";

export const RegisterShopComponent = () => {
  const { onEncryptInput, isEncryptingInput, inputEncryptionDisabled } = useEncryptInput();
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "EVVMCafe",
  });

  const handleRegisterShop = async () => {
    // Encrypt zero balance
    const zeroBalance = await onEncryptInput(FheTypes.Uint64, 0n);

    if (!zeroBalance) {
      console.error("Failed to encrypt balance");
      return;
    }

    // Register shop
    await writeContractAsync({
      functionName: "registerShopInEVVM",
      args: [zeroBalance],
    });
  };

  const isLoading = isEncryptingInput || isPending;

  return (
    <button
      onClick={handleRegisterShop}
      disabled={isLoading || inputEncryptionDisabled}
    >
      {isLoading ? "Registering..." : "Register Shop in EVVM"}
    </button>
  );
};
```

## Common Patterns

### Pattern 1: Encrypt Before Write

Always encrypt values before sending to contracts:

```typescript
// ✅ Correct
const encryptedValue = await onEncryptInput(FheTypes.Uint64, amount);
await writeContractAsync({
  functionName: "someFunction",
  args: [encryptedValue],
});

// ❌ Wrong - sending plaintext
await writeContractAsync({
  functionName: "someFunction",
  args: [amount], // This will fail!
});
```

### Pattern 2: Check CoFHE Connection

Always check if CoFHE is connected before encryption:

```typescript
const { inputEncryptionDisabled } = useEncryptInput();

if (inputEncryptionDisabled) {
  // Show message: "Please connect CoFHE"
  return;
}
```

### Pattern 3: Handle Decryption States

Handle all decryption states properly:

```typescript
const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, encryptedValue);

switch (result.state) {
  case "no-data":
    return <p>No balance data</p>;
  case "encrypted":
    return <button onClick={onDecrypt}>Decrypt</button>;
  case "pending":
    return <p>Decrypting...</p>;
  case "success":
    return <p>Balance: {result.value?.toString()}</p>;
  case "error":
    return <p className="text-error">Error: {result.error}</p>;
}
```

### Pattern 4: Get EVVM Nonce

Always get the current nonce before making a transaction:

```typescript
// Get client's virtual address
const { data: clientVaddr } = useScaffoldReadContract({
  contractName: "EVVMCore",
  functionName: "getVaddrFromAddress",
  args: [address],
});

// Get current nonce
const { data: evvmNonce } = useScaffoldReadContract({
  contractName: "EVVMCore",
  functionName: "getNonce",
  args: [clientVaddr],
});

// Use nonce in transaction
await writeContractAsync({
  functionName: "orderCoffee",
  args: [/* ... */, evvmNonce],
});
```

## Troubleshooting

### Issue: "CoFHE not connected"

**Solution**: 
1. Click the CoFHE Portal button (shield icon) in the header
2. Ensure wallet is connected
3. Ensure you're on a supported network (Hardhat, Sepolia, Arbitrum Sepolia)
4. Wait for CoFHE to initialize

### Issue: "Failed to encrypt input"

**Possible Causes**:
- CoFHE not connected
- Invalid value type
- Network issues

**Solution**:
- Check CoFHE connection status
- Verify value is correct type (bigint, string, or number)
- Check browser console for detailed error

### Issue: "Decryption failed"

**Possible Causes**:
- No valid permit
- Permit expired
- Insufficient permissions

**Solution**:
1. Open CoFHE Portal
2. Create a new permit if needed
3. Ensure permit is active
4. Check permit expiration date

### Issue: "Nonce mismatch"

**Possible Causes**:
- Using outdated nonce
- Previous transaction not yet confirmed

**Solution**:
- Always fetch nonce right before transaction
- Wait for previous transaction to confirm
- Use service-level nonces for additional protection

### Issue: "Account not registered"

**Solution**:
- Register account first using `registerAccountFromAddress`
- Ensure you're using the correct address
- Check if account exists using `getVaddrFromAddress`

## Best Practices

1. **Always Encrypt**: Never send plaintext values to FHE-enabled contracts
2. **Check Connection**: Always verify CoFHE is connected before encryption
3. **Handle States**: Properly handle all encryption/decryption states
4. **Fresh Nonces**: Always fetch nonces right before transactions
5. **Error Handling**: Provide clear error messages to users
6. **Loading States**: Show loading indicators during async operations
7. **Permit Management**: Guide users to create permits when needed

## Additional Resources

- [CoFHE SDK Documentation](https://cofhe-docs.fhenix.zone/docs/devdocs/overview)
- [EVVMCafe Integration Guide](./EVVMCafe_INTEGRATION.md)
- [Scaffold-ETH 2 Hooks](https://docs.scaffoldeth.io/hooks/)

