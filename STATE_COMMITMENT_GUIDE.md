# State Commitment Calculation Guide

This guide explains how to calculate and update state commitments for the EVVM Core virtual blockchain.

## Table of Contents

- [Overview](#overview)
- [Why Off-Chain?](#why-off-chain)
- [Usage](#usage)
- [Implementation Details](#implementation-details)
- [Integration](#integration)

## Overview

State commitments are cryptographic hashes that represent the entire state of the virtual blockchain at a given point in time. They serve as:

- **Cryptographic Proof**: Verifiable proof of the entire system state
- **Integrity Check**: Allows verification that state hasn't been tampered with
- **Snapshot**: Historical record of state at specific blocks

The state commitment is typically a **Merkle root** of all account states (vaddr, balance, nonce).

## Why Off-Chain?

State commitments **must** be calculated off-chain for several reasons:

### 1. Encrypted Data Limitation

- On-chain, we only have access to encrypted handles (`euint64`), not plaintext values
- A state commitment needs to represent the **actual state** (real balances, nonces), not encrypted handles
- Hashing an encrypted handle would only prove the handle exists, not the actual balance

### 2. Decryption Requirement

- To create a meaningful state commitment, we need to decrypt balances first
- Decryption requires the private key/decryption key, which **cannot be used on-chain**
- CoFHE SDK provides off-chain decryption capabilities

### 3. Efficiency

- Building Merkle trees and hashing all accounts is **gas-intensive**
- Off-chain calculation is more efficient and can be done by indexers/validators
- The commitment is then submitted on-chain via `updateStateCommitment()` or `createVirtualBlock()`

### 4. Privacy Consideration

- The commitment is a hash, so it doesn't reveal individual balances
- Only authorized parties (with decryption keys) can calculate it
- The commitment itself is public and verifiable

## Usage

### Basic Usage

Calculate state commitment without updating on-chain:

```bash
yarn workspace @se-2/hardhat hardhat run scripts/calculateStateCommitment.ts --network localhost
```

### Update On-Chain

Calculate and automatically update the commitment on-chain using environment variable:

```bash
UPDATE_ON_CHAIN=true yarn workspace @se-2/hardhat hardhat run scripts/calculateStateCommitment.ts --network localhost
```

### Custom Contract Address

Specify a custom EVVMCore contract address:

```bash
EVVM_CORE_ADDRESS=0x0165878A594ca255338adfa4d48449f69242Eb8F \
UPDATE_ON_CHAIN=true \
yarn workspace @se-2/hardhat hardhat run scripts/calculateStateCommitment.ts --network localhost
```

### Options (Environment Variables)

- `EVVM_CORE_ADDRESS`: EVVMCore contract address (default: from deployments)
- `UPDATE_ON_CHAIN`: Set to `"true"` to update the commitment on-chain after calculation
- `USE_SIMPLE_HASH`: Set to `"true"` to use simple hash instead of Merkle tree (for small state sizes)
- `ONLY_ADDRESS_BASED`: Set to `"true"` to only include accounts registered from addresses (compatibility layer)

**Note**: Due to Hardhat's argument parsing, options are passed via environment variables. You can also pass them as script arguments after the script name if running directly with Node.js.

### Example Output

```
📊 Calculating state commitment...
  → Fetching account states...
  ✓ Found 3 accounts
  → Calculating Merkle tree...
  ✓ State commitment: 0xabc123...
  📋 Account summary:
     - 0x12345678...: balance=1000, nonce=0
     - 0x87654321...: balance=500, nonce=1
     - 0xabcdef12...: balance=250, nonce=0
     ... and 0 more accounts

📝 Updating state commitment on-chain...
  → Transaction hash: 0xdef456...
  ✓ State commitment updated on-chain

✅ State commitment calculation complete!
   Commitment: 0xabc123...
```

## Implementation Details

### Account Discovery

The utility discovers accounts in two ways:

1. **From Events** (default): Queries `VirtualAccountRegistered` events to find all registered accounts
2. **Address-Based** (with `--only-address-based`): Queries `AccountRegisteredFromAddress` events for compatibility layer accounts

### Decryption Process

For each discovered account:

1. Fetch encrypted balance using `getEncryptedBalance(vaddr)`
2. Decrypt balance using CoFHE SDK: `cofheClient.decryptHandle(encryptedBalance, FheTypes.Uint64)`
3. Fetch nonce using `getNonce(vaddr)`
4. Build account state: `{ vaddr, balance, nonce }`

### Merkle Tree Construction

1. **Sort accounts** by vaddr for deterministic tree
2. **Create leaves**: Hash of `(vaddr, balance, nonce)` for each account
3. **Build tree**: Recursively hash pairs of nodes until root is reached
4. **Return root**: The Merkle root is the state commitment

### Simple Hash Alternative

For small state sizes, a simple hash can be used instead:

1. Sort accounts by vaddr
2. Encode all account states
3. Concatenate and hash all encodings

This is faster but less efficient for large states.

## Integration

### Programmatic Usage

Use the utility functions directly in your code:

```typescript
import {
  calculateStateCommitment,
  getAllAccountStates,
  StateCommitmentOptions,
} from "../utils/stateCommitment";

// Initialize
const evvmCore = await ethers.getContractAt("EVVMCore", address);
const cofheClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(signer);

// Calculate commitment
const options: StateCommitmentOptions = {
  evvmCore,
  cofheClient,
  onlyAddressBased: false,
};

const commitment = await calculateStateCommitment(options, true); // true = use Merkle tree

// Update on-chain
await evvmCore.updateStateCommitment(commitment);
```

### Periodic Updates

For production systems, state commitments should be updated periodically:

1. **Indexer/Validator**: Runs the calculation script periodically (e.g., every block or every N blocks)
2. **Submit to Chain**: Calls `updateStateCommitment()` or `createVirtualBlock()` with the new commitment
3. **Verification**: Other parties can verify the commitment matches their own calculation

### Integration with Block Creation

When creating a new virtual block:

```typescript
// 1. Calculate state commitment
const commitment = await calculateStateCommitment(options);

// 2. Create block with commitment
await evvmCore.createVirtualBlock(commitment);
```

### Integration with Batch Operations

After batch transfers:

```typescript
// 1. Execute batch transfers
await evvmCore.applyTransferBatch(transfers);

// 2. Calculate new state commitment
const commitment = await calculateStateCommitment(options);

// 3. Update commitment
await evvmCore.updateStateCommitmentAfterBatch(commitment);
```

## Security Considerations

1. **Decryption Keys**: Only authorized parties with decryption keys can calculate commitments
2. **Deterministic**: The calculation must be deterministic (sorted accounts, consistent encoding)
3. **Verification**: Anyone can verify a commitment by recalculating it (if they have decryption access)
4. **Privacy**: The commitment is a hash and doesn't reveal individual account balances

## Limitations

1. **Event-Based Discovery**: Relies on events, so accounts registered before event indexing won't be included
2. **Decryption Access**: Requires CoFHE SDK access with proper decryption keys
3. **Gas Costs**: Updating on-chain requires gas (though calculation is free off-chain)
4. **State Size**: For very large states, Merkle tree construction may be slow

## Future Enhancements

1. **Zero-Knowledge Proofs**: Use ZK proofs to prove state without revealing balances
2. **Incremental Updates**: Only recalculate changed accounts instead of full state
3. **Multiple Validators**: Multiple validators calculate and submit commitments for consensus
4. **State Snapshots**: Store historical commitments for state recovery

## References

- [EVVM Core Contract](../packages/hardhat/contracts/core/EVVM.core.sol)
- [State Commitment Utility](../packages/hardhat/utils/stateCommitment.ts)
- [Calculation Script](../packages/hardhat/scripts/calculateStateCommitment.ts)