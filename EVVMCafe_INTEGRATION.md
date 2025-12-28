# EVVMCafe Integration Guide

This guide explains how to integrate and use the EVVMCafe example contract with the FHE-enabled EVVM Core system.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Smart Contract Integration](#smart-contract-integration)
- [Frontend Integration](#frontend-integration)
- [Usage Flow](#usage-flow)
- [FHE Integration Pattern](#fhe-integration-pattern)
- [Limitations](#limitations)

## Overview

EVVMCafe is an example application that demonstrates how to build a real-world dApp on top of EVVM Core using Fully Homomorphic Encryption (FHE). It allows users to order coffee with encrypted payments, maintaining privacy while processing transactions on a virtual blockchain.

### Key Features

- **Encrypted Payments**: All payment amounts are encrypted using FHE
- **Virtual Blockchain**: Transactions are processed on EVVM's virtual chain
- **Address Compatibility**: Uses Ethereum addresses for easy integration with traditional contracts
- **Privacy-Preserving**: Balances and transaction amounts remain encrypted on-chain

## Architecture

```
┌─────────────────┐
│   Frontend      │
│  (Next.js)      │
└────────┬────────┘
         │
         │ Encrypted amounts
         │ (InEuint64)
         ▼
┌─────────────────┐
│   EVVMCafe      │
│   Contract      │
└────────┬────────┘
         │
         │ requestPay()
         │ (address-based)
         ▼
┌─────────────────┐
│   EVVMCore      │
│   Contract      │
└─────────────────┘
```

### Components

1. **EVVMCore**: The core virtual blockchain contract that manages virtual accounts, encrypted balances, and virtual transactions
2. **EVVMCafe**: The coffee shop contract that handles orders and integrates with EVVMCore
3. **Frontend**: React application that encrypts/decrypts values using CoFHE SDK

## Smart Contract Integration

### Contract Addresses

After deployment, you'll have:

- `EVVMCore`: The core virtual blockchain contract
- `EVVMCafe`: The coffee shop contract (depends on EVVMCore)

### Key Functions

#### EVVMCafe Functions

**Order Coffee**
```solidity
function orderCoffee(
    address clientAddress,
    string memory coffeeType,
    uint256 quantity,
    InEuint64 calldata totalPriceEnc,
    uint256 nonce,
    uint64 evvmNonce
) external
```

**Register Shop**
```solidity
function registerShopInEVVM(InEuint64 calldata initialBalance) external
```

**Query Balances**
```solidity
function getShopBalance() external view returns (euint64)
function getClientBalance(address client) external view returns (euint64)
```

**Withdraw Funds**
```solidity
function withdrawFunds(address to, InEuint64 calldata amountEnc) external onlyOwner
```

#### EVVMCore Functions (used by EVVMCafe)

**Register Account from Address**
```solidity
function registerAccountFromAddress(
    address realAddress,
    InEuint64 calldata initialBalance
) external
```

**Request Payment (Address-based)**
```solidity
function requestPay(
    address from,
    address to,
    InEuint64 calldata amount,
    uint64 expectedNonce
) external returns (uint256 txId)
```

**Get Virtual Address**
```solidity
function getVaddrFromAddress(address realAddress) external view returns (bytes32)
```

## Frontend Integration

### Prerequisites

1. CoFHE SDK initialized and connected
2. Wallet connected to supported network
3. Valid permit for decryption operations

### Setup

The frontend uses the following hooks from the CoFHE SDK:

```typescript
import { useCofheConnected } from "~~/app/useCofhe";
import { useEncryptInput } from "~~/app/useEncryptInput";
import { useDecryptValue } from "~~/app/useDecrypt";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
```

### Reading Encrypted Balances

```typescript
// Read shop balance
const { data: shopBalance } = useScaffoldReadContract({
  contractName: "EVVMCafe",
  functionName: "getShopBalance",
});

// Decrypt the balance
const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, shopBalance);
```

### Encrypting Payment Amounts

```typescript
const { onEncryptInput, isEncryptingInput } = useEncryptInput();

// Calculate total price
const coffeePrice = 4; // tokens
const quantity = 2;
const totalPrice = coffeePrice * quantity;

// Encrypt the amount
const encryptedAmount = await onEncryptInput(FheTypes.Uint64, totalPrice);
```

### Placing an Order

```typescript
const { writeContractAsync } = useScaffoldWriteContract({ contractName: "EVVMCafe" });

// Get current EVVM nonce
const { data: clientVaddr } = useScaffoldReadContract({
  contractName: "EVVMCore",
  functionName: "getVaddrFromAddress",
  args: [clientAddress],
});

const { data: evvmNonce } = useScaffoldReadContract({
  contractName: "EVVMCore",
  functionName: "getNonce",
  args: [clientVaddr],
});

// Place order
await writeContractAsync({
  functionName: "orderCoffee",
  args: [
    clientAddress,
    "espresso",
    quantity,
    encryptedAmount,
    serviceNonce, // Unique service-level nonce
    evvmNonce,    // EVVM account nonce
  ],
});
```

## Usage Flow

### 1. Initial Setup

**Deploy Contracts**
```bash
# Start local blockchain
yarn chain

# Deploy contracts
yarn deploy:local

# Verify setup
yarn workspace @se-2/hardhat hardhat run scripts/setupEvvmCafe.ts --network localhost
```

**Register Shop in EVVM**
```typescript
// In frontend or script
const zeroBalance = await onEncryptInput(FheTypes.Uint64, 0n);
await evvmCafe.registerShopInEVVM(zeroBalance);
```

### 2. Client Registration

**Register Client Account**
```typescript
// Client registers with initial balance
const initialBalance = await onEncryptInput(FheTypes.Uint64, 1000n); // 1000 tokens
await evvmCore.registerAccountFromAddress(clientAddress, initialBalance);
```

### 3. Ordering Coffee

**Complete Order Flow**
```typescript
// 1. Get coffee price
const price = await evvmCafe.getCoffeePrice("espresso"); // Returns 2

// 2. Calculate total
const quantity = 2;
const totalPrice = price * BigInt(quantity); // 4 tokens

// 3. Encrypt total price
const encryptedPrice = await onEncryptInput(FheTypes.Uint64, totalPrice);

// 4. Get EVVM nonce
const clientVaddr = await evvmCore.getVaddrFromAddress(clientAddress);
const evvmNonce = await evvmCore.getNonce(clientVaddr);

// 5. Place order
await evvmCafe.orderCoffee(
  clientAddress,
  "espresso",
  quantity,
  encryptedPrice,
  serviceNonce, // Unique per order
  evvmNonce
);
```

### 4. Checking Balances

**Query Encrypted Balance**
```typescript
// Get encrypted balance
const { data: encryptedBalance } = useScaffoldReadContract({
  contractName: "EVVMCafe",
  functionName: "getClientBalance",
  args: [clientAddress],
});

// Decrypt to display
const { onDecrypt, result } = useDecryptValue(FheTypes.Uint64, encryptedBalance);

// Call onDecrypt when user wants to see balance
// result.value will contain the decrypted amount
```

### 5. Withdrawing Funds

**Shop Owner Withdraws**
```typescript
// Encrypt withdrawal amount
const withdrawAmount = await onEncryptInput(FheTypes.Uint64, 50n);

// Withdraw (only owner)
await evvmCafe.withdrawFunds(ownerAddress, withdrawAmount);
```

## FHE Integration Pattern

### Pattern Overview

The FHE integration follows this pattern:

1. **Encrypt on Frontend**: User input is encrypted using CoFHE SDK before sending to contract
2. **Process on Contract**: Contract performs operations on encrypted values using FHE operations
3. **Decrypt for Display**: Encrypted results are decrypted on frontend for user display

### Encryption Flow

```
User Input (plaintext)
    ↓
CoFHE SDK encryptInputs()
    ↓
InEuint64 (encrypted handle)
    ↓
Smart Contract (FHE operations)
    ↓
euint64 (encrypted storage)
```

### Decryption Flow

```
euint64 (from contract)
    ↓
ctHash (bigint)
    ↓
CoFHE SDK decryptHandle()
    ↓
Plaintext value (for display)
```

### Access Control

FHE values require explicit access control:

```solidity
// After creating encrypted value
euint64 balance = FHE.asEuint64(initialBalance);

// Allow contract to operate on it
FHE.allowThis(balance);

// Allow sender to read/use it
FHE.allowSender(balance);
```

## Limitations

### Current MVP Limitations

1. **No Signature Validation**: Service-level nonces prevent replay, but no cryptographic signatures
2. **Plaintext Prices**: Coffee prices are stored in plaintext (could be encrypted in future)
3. **Single Token**: Only one token type supported (could be extended to multi-token)
4. **No Staking/Rewards**: Staking and reward systems are not implemented
5. **Synchronous Nonces**: Nonces must be used sequentially (async nonces planned for future)

### Privacy Trade-offs

The address-to-vaddr compatibility layer creates a public link between Ethereum addresses and virtual addresses. This is necessary for integration with traditional contracts but reduces privacy compared to pure virtual addresses.

**Privacy Options**:
- Use `registerAccount()` with random `vaddr` for maximum privacy
- Use `registerAccountFromAddress()` for easier integration (less privacy)

## Testing

### Running Integration Tests

```bash
yarn test test/EVVMCafe.integration.test.ts
```

### Test Coverage

The integration tests cover:
- Contract deployment
- Shop registration
- Client registration
- Coffee ordering with encrypted payments
- Balance queries
- Fund withdrawal
- Replay attack prevention
- Error handling

## Gas Costs

Approximate gas costs (as of implementation):

- `registerShopInEVVM`: ~205,481 gas
- `orderCoffee`: ~754,656 gas
- `withdrawFunds`: ~804,480 gas
- `registerAccountFromAddress`: ~198,840 gas

## Next Steps

1. **Frontend UI**: Build a complete UI for ordering coffee
2. **State Commitment**: Implement off-chain state commitment calculation
3. **Async Nonces**: Add support for out-of-order nonce processing
4. **Multi-token**: Extend to support multiple token types
5. **Encrypted Prices**: Encrypt coffee prices for additional privacy

## References

- [EVVM Core Documentation](./DEVELOPMENT_PLAN.md)
- [CoFHE SDK Documentation](https://cofhe-docs.fhenix.zone/docs/devdocs/overview)
- [Scaffold-ETH 2 Documentation](https://docs.scaffoldeth.io)

