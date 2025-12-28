# Incremental Development Plan - EVVM Core

This document describes the 10 incremental steps to develop the EVVM Core contract. Each step is an independent, compilable, and functional commit.

---

## 📋 Step 1: Base Contract Structure

**Objective**: Establish the contract foundation with imports, constructor, and basic data structures.

**Files to create/modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Code to include**:
- CoFHE and Ownable imports
- Basic `VirtualAccount` struct (only with `exists` flag initially)
- Essential state variables:
  - `vChainId` (immutable)
  - `vBlockNumber`
  - `evvmID`
  - `mapping(bytes32 => VirtualAccount) private accounts`
- Basic constructor
- Basic events (declarations only)

**Context**: This step establishes the minimum contract foundation without operational functionality. It's the "skeleton" we'll build upon.

**Commit message**: `feat: Add base contract structure with VirtualAccount mapping`

---

## 📋 Step 2: Virtual Account System

**Objective**: Implement virtual account registration and basic queries.

**Features to add**:

- `registerAccount(bytes32 vaddr, InEuint64 initialBalance)`
- `accountExists(bytes32 vaddr)`
- Complete `VirtualAccount` struct with `balance` and `nonce`
- `VirtualAccountRegistered` event

**Key code**:

```solidity
function registerAccount(bytes32 vaddr, InEuint64 calldata initialBalance) external {
    require(!accounts[vaddr].exists, "EVVM: account already exists");
    euint64 balance = FHE.asEuint64(initialBalance);
    accounts[vaddr] = VirtualAccount({
        balance: balance,
        nonce: 0,
        exists: true
    });
    FHE.allowThis(balance);
    FHE.allowSender(balance);
    emit VirtualAccountRegistered(vaddr, 0);
}
```

**Context**: This step enables creating virtual accounts with encrypted balances. It's the foundation for all subsequent operations.

**Commit message**: `feat: Implement virtual account registration with encrypted balances`

---

## 📋 Step 3: Basic Transfers

**Objective**: Implement transfers between virtual accounts with nonce validation.

**Features to add**:

- `applyTransfer()` - main transfer function
- Nonce validation for replay protection
- FHE operations (sub/add) on encrypted balances
- Automatic `vBlockNumber` increment
- `VirtualTransferApplied` event

**Key code**:
```solidity
function applyTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    InEuint64 calldata amount,
    uint64 expectedNonce
) external returns (uint256 txId) {
    // Validations and FHE operations
    euint64 amountEnc = FHE.asEuint64(amount);
    euint64 newFromBalance = FHE.sub(fromAcc.balance, amountEnc);
    euint64 newToBalance = FHE.add(toAcc.balance, amountEnc);
    // ...
}
```

**Context**: This is the heart of the payment system. It allows transferring encrypted funds between virtual accounts while maintaining privacy.

**Commit message**: `feat: Add encrypted transfer functionality with nonce validation`

---

## 📋 Step 4: Virtual Chain Progression

**Objective**: Implement virtual block system and state commitment.

**Features to add**:

- `stateCommitment` variable
- `createVirtualBlock(bytes32 newCommitment)`
- `updateStateCommitment(bytes32 newCommitment)`
- `VirtualBlockCreated` and `StateCommitmentUpdated` events
- Improve `applyTransfer()` to emit block events

**Context**: This step transforms the system into a true virtual blockchain with block progression and state commitments.

**Commit message**: `feat: Implement virtual block progression and state commitments`

---

## 📋 Step 4B: State Commitment Calculation (Off-Chain)

**Objective**: Document and provide utilities for calculating state commitments off-chain.

**Files to create/modify**:
- `packages/hardhat/scripts/calculateStateCommitment.ts` (TypeScript utility)
- `DEVELOPMENT_PLAN.md` (documentation)

**Features to add**:

- TypeScript utility script to calculate state commitments
- Function to fetch all virtual accounts from the contract
- Function to decrypt balances (using CoFHE SDK)
- Function to build Merkle tree from account states
- Function to generate state commitment hash
- Documentation explaining why commitments must be calculated off-chain

**Key code structure**:

```typescript
// packages/hardhat/scripts/calculateStateCommitment.ts

import { ethers } from "hardhat";
import { CoFHE } from "@fhenixprotocol/cofhe-sdk";

interface AccountState {
    vaddr: string;
    balance: bigint;  // Decrypted balance
    nonce: number;
}

async function calculateStateCommitment(
    evvmCoreAddress: string
): Promise<string> {
    const evvmCore = await ethers.getContractAt("EVVMCore", evvmCoreAddress);
    const cofheClient = new CoFHE(/* config */);
    
    // 1. Get all registered accounts (requires indexing or events)
    const accounts = await getAllAccounts(evvmCore);
    
    // 2. Decrypt balances for each account
    const accountStates: AccountState[] = [];
    for (const account of accounts) {
        const encryptedBalance = await evvmCore.getEncryptedBalance(account.vaddr);
        const balance = await cofheClient.decrypt(encryptedBalance);
        const nonce = await evvmCore.getNonce(account.vaddr);
        
        accountStates.push({
            vaddr: account.vaddr,
            balance: balance,
            nonce: nonce
        });
    }
    
    // 3. Build Merkle tree from account states
    const leaves = accountStates.map(acc => 
        ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "uint64", "uint64"],
                [acc.vaddr, acc.balance, acc.nonce]
            )
        )
    );
    
    // 4. Calculate Merkle root (state commitment)
    const stateCommitment = calculateMerkleRoot(leaves);
    
    return stateCommitment;
}

function calculateMerkleRoot(leaves: string[]): string {
    // Merkle tree implementation
    // ... (use a library like merkletreejs or implement custom)
}
```

**Why Off-Chain?**

1. **Encrypted Data Limitation**: 
   - On-chain, we only have access to encrypted handles (`euint64`), not plaintext values
   - A state commitment needs to represent the actual state (real balances, nonces), not encrypted handles
   - Hashing an encrypted handle would only prove the handle exists, not the actual balance

2. **Decryption Requirement**:
   - To create a meaningful state commitment, we need to decrypt balances first
   - Decryption requires the private key/decryption key, which cannot be used on-chain
   - CoFHE SDK provides off-chain decryption capabilities

3. **Efficiency**:
   - Building Merkle trees and hashing all accounts is gas-intensive
   - Off-chain calculation is more efficient and can be done by indexers/validators
   - The commitment is then submitted on-chain via `updateStateCommitment()` or `createVirtualBlock()`

4. **Privacy Consideration**:
   - The commitment is a hash, so it doesn't reveal individual balances
   - Only authorized parties (with decryption keys) can calculate it
   - The commitment itself is public and verifiable

**Alternative Approaches**:

- **Option 1**: Hash encrypted handles directly (less secure, doesn't represent real state)
- **Option 2**: Use zero-knowledge proofs to prove state without revealing it (future enhancement)
- **Option 3**: Trusted validators calculate and submit commitments (current approach)

**Context**: This step provides the necessary tooling and documentation for calculating state commitments. It's essential for maintaining blockchain integrity while preserving privacy through FHE. The commitment serves as a cryptographic proof of the entire system state at a given block.

**Commit message**: `feat: Add off-chain state commitment calculation utilities and documentation`

---

## 📋 Step 5: Virtual Transaction Registry

**Objective**: Store and query applied virtual transactions.

**Features to add**:

- Complete `VirtualTransaction` struct
- `mapping(uint256 => VirtualTransaction) public virtualTransactions`
- `nextTxId` variable
- Modify `applyTransfer()` to save the transaction
- `getVirtualTransaction(uint256 txId)`

**Context**: This step enables audit and historical query of transactions, essential for a complete virtual blockchain.

**Commit message**: `feat: Add virtual transaction storage and retrieval`

---

## 📋 Step 6: Batch Transfers

**Objective**: Allow processing multiple transfers in a single virtual block.

**Features to add**:

- `TransferParams` struct
- `applyTransferBatch(TransferParams[] calldata transfers)`
- Individual transaction error handling
- Grouping txs in a single block

**Key code**:

```solidity
function applyTransferBatch(TransferParams[] calldata transfers) 
    external returns (uint256 successfulTxs, uint256 failedTxs, uint256[] memory txIds) {
    // Process each transfer with try/catch
    // Group in a single virtual block
}
```

**Context**: Improves efficiency by allowing batch processing of multiple transactions, similar to blocks in real blockchains.

**Commit message**: `feat: Add batch transfer processing for multiple transactions per block`

---

## 📋 Step 7: Utility Functions

**Objective**: Add helper and query functions to improve usability.

**Features to add**:

- `generateVaddrFromAddress(address realAddress, bytes32 salt)` - helper to generate vaddr
- `getAccount(bytes32 vaddr)` - get complete account
- `getEncryptedBalance(bytes32 vaddr)` - query encrypted balance
- `getNonce(bytes32 vaddr)` - query nonce

**Context**: These functions facilitate interaction with the contract from frontend and other contracts.

**Commit message**: `feat: Add utility functions for account management and queries`

---

## 📋 Step 8: Advanced Block Management

**Objective**: Improve virtual block system with more control and flexibility.

**Features to add**:

- Improve `createVirtualBlock()` with validations
- Better integrate `stateCommitment` in transfer flow
- Optional: function to get block information

**Context**: Refines the block system for greater control and prepares the ground for future improvements (validators, consensus, etc.).

**Commit message**: `feat: Enhance virtual block management with improved state commitment handling`

---

## 📋 Step 9: Admin Functions and Testing

**Objective**: Add administrative functions and testing tools.

**Features to add**:

- `setEvvmID(uint256 newEvvmID)` - update EVVM ID
- `faucetAddBalance(bytes32 vaddr, InEuint64 amount)` - faucet for testing
- Improve FHE permissions in all functions
- Additional validations where necessary

**Context**: These functions are essential for development, testing, and contract maintenance in production.

**Commit message**: `feat: Add admin functions and testing utilities (faucet, evvmID management)`

---

## 📋 Step 10: Documentation and Complete Events

**Objective**: Complete documentation, events, and finalize the contract.

**Tasks**:

- Complete all missing events
- Add complete NatSpec to all functions
- Review and improve comments
- Add notes on limitations and future improvements
- Verify all events are emitted correctly
- Document the complete usage flow

**Context**: This step ensures the contract is well documented and production-ready, facilitating future maintenance and scaling.

**Commit message**: `docs: Complete NatSpec documentation and finalize events`

---

## 📊 Progress Summary

| Step | Main Functionality | Dependencies |
|------|-------------------|--------------|
| 1 | Base structure | None |
| 2 | Virtual accounts | Step 1 |
| 3 | Transfers | Step 2 |
| 4 | Virtual blocks | Step 3 |
| 5 | Transaction registry | Step 3 |
| 6 | Batch transfers | Step 3, 5 |
| 7 | Utilities | Step 2, 3 |
| 8 | Block management | Step 4 |
| 9 | Admin/Testing | All previous |
| 10 | Documentation | All previous |

---

## 🚀 Usage Guide

To implement each step:

1. **Create branch**: `git checkout -b step-X-feature-name`
2. **Implement code**: Follow the code described in each step
3. **Compile**: `yarn hardhat compile`
4. **Verify**: Ensure it compiles without errors
5. **Commit**: Use the suggested message
6. **Merge**: `git checkout main && git merge step-X-feature-name`

---

## 📝 Important Notes

- Each step must compile independently
- Don't add functionalities from future steps in previous steps
- Keep code simple and functional in each step
- Tests can be added after Step 10
- Signature validation can be added as a future extension

---

---

## 📋 Step 13: Address-to-Vaddr Compatibility Layer

**Objective**: Add compatibility functions to map Ethereum addresses to virtual addresses, enabling integration with traditional contracts.

**Files to create/modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Features to add**:

- `mapping(address => bytes32) public addressToVaddr` - maps real addresses to virtual addresses
- `mapping(bytes32 => address) public vaddrToAddress` - reverse mapping
- `registerAccountFromAddress(address realAddress, InEuint64 initialBalance)` - convenience function that auto-generates vaddr
- `getVaddrFromAddress(address realAddress) external view returns (bytes32)` - query vaddr for an address
- `requestPay(address from, address to, InEuint64 amount, uint64 nonce)` - compatibility function that uses addresses instead of vaddr

**Key code**:

```solidity
mapping(address => bytes32) public addressToVaddr;
mapping(bytes32 => address) public vaddrToAddress;

function registerAccountFromAddress(
    address realAddress,
    InEuint64 calldata initialBalance
) external {
    bytes32 vaddr = keccak256(abi.encodePacked(realAddress, vChainId, evvmID));
    require(!accounts[vaddr].exists, "EVVM: account already exists");
    
    addressToVaddr[realAddress] = vaddr;
    vaddrToAddress[vaddr] = realAddress;
    
    registerAccount(vaddr, initialBalance);
}

function requestPay(
    address from,
    address to,
    InEuint64 calldata amount,
    uint64 expectedNonce
) external returns (uint256 txId) {
    bytes32 fromVaddr = addressToVaddr[from];
    bytes32 toVaddr = addressToVaddr[to];
    
    require(fromVaddr != bytes32(0), "EVVM: from address not registered");
    require(toVaddr != bytes32(0), "EVVM: to address not registered");
    
    return applyTransfer(fromVaddr, toVaddr, amount, expectedNonce);
}
```

**Context**: This step enables traditional Solidity contracts (like EVVMCafe) to interact with EVVM using Ethereum addresses instead of virtual addresses. It bridges the gap between the public address model and the private virtual address model.

**Commit message**: `feat: Add address-to-vaddr compatibility layer for contract integration`

---

## 📋 Step 14: EVVMCafe Contract Adaptation

**Objective**: Create an adapted version of EVVMCafe that works with the FHE-enabled EVVM Core.

**Files to create**:
- `packages/hardhat/contracts/examples/EVVMCafe.sol`

**Features to implement**:

- Remove dependency on `EvvmService` library
- Use `EVVMCore` directly with address-based functions
- Adapt `orderCoffee()` to use encrypted amounts (`InEuint64`)
- Remove staking/rewards functionality (or mark as TODO for future)
- Simplify signature validation (or use basic EIP-712)
- Add helper functions for encrypted balance queries

**Key code structure**:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "../core/EVVM.core.sol";

contract EVVMCafe {
    EVVMCore public evvmCore;
    address public ownerOfShop;
    
    // Service nonce tracking (simplified)
    mapping(address => mapping(uint256 => bool)) private usedNonces;
    
    constructor(address _evvmAddress, address _ownerOfShop) {
        evvmCore = EVVMCore(_evvmAddress);
        ownerOfShop = _ownerOfShop;
    }
    
    function orderCoffee(
        address clientAddress,
        string memory coffeeType,
        uint256 quantity,
        InEuint64 calldata totalPriceEnc,  // Encrypted price
        uint256 nonce,
        bytes memory signature,
        uint64 evvmNonce
    ) external {
        // 1. Validate service signature
        // 2. Check service nonce
        // 3. Request payment via EVVM (using address-based function)
        evvmCore.requestPay(
            clientAddress,
            address(this),
            totalPriceEnc,
            evvmNonce
        );
        // 4. Mark nonce as used
        usedNonces[clientAddress][nonce] = true;
    }
    
    function withdrawFunds(address to, InEuint64 calldata amount) external onlyOwner {
        // Transfer encrypted funds from shop to owner
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        bytes32 toVaddr = evvmCore.getVaddrFromAddress(to);
        uint64 nonce = evvmCore.getNonce(shopVaddr);
        
        evvmCore.applyTransfer(shopVaddr, toVaddr, amount, nonce);
    }
}
```

**Context**: This step demonstrates how to build a real-world application on top of EVVM with FHE. It shows the pattern for integrating traditional contracts with the virtual blockchain while maintaining privacy through encrypted amounts.

**Commit message**: `feat: Add EVVMCafe example contract adapted for FHE-enabled EVVM`

---

## 📋 Step 15: Example Integration Testing and Documentation

**Objective**: Complete the EVVMCafe integration with testing utilities and comprehensive documentation.

**Files to create/modify**:
- `packages/hardhat/contracts/examples/EVVMCafe.sol` (complete implementation)
- `packages/hardhat/test/EVVMCafe.integration.test.ts` (optional, for future)

**Features to add**:

- Complete `EVVMCafe` implementation with all helper functions
- Add `getShopBalance()` - returns encrypted balance of the shop
- Add `getClientBalance(address client)` - returns encrypted balance of a client
- Add proper error handling and events
- Add NatSpec documentation explaining the FHE integration pattern
- Add usage examples in comments

**Key additions**:

```solidity
/// @notice Returns the encrypted balance of the coffee shop
/// @dev Frontend must decrypt this using cofhesdkClient.decryptHandle()
function getShopBalance() external view returns (euint64) {
    bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
    return evvmCore.getEncryptedBalance(shopVaddr);
}

/// @notice Returns the encrypted balance of a client
/// @param client Address of the client
/// @dev Frontend must decrypt this using cofhesdkClient.decryptHandle()
function getClientBalance(address client) external view returns (euint64) {
    bytes32 clientVaddr = evvmCore.getVaddrFromAddress(client);
    return evvmCore.getEncryptedBalance(clientVaddr);
}

/// @notice Event emitted when coffee is ordered
event CoffeeOrdered(
    address indexed client,
    string coffeeType,
    uint256 quantity,
    uint64 evvmNonce
);
```

**Documentation to add**:

- Usage flow: How to register accounts, place orders, and withdraw funds
- FHE integration pattern: How to handle encrypted amounts in contracts
- Frontend integration: How to encrypt/decrypt amounts using CoFHE SDK
- Limitations: What features are not yet implemented (staking, rewards, etc.)

**Context**: This step completes the example integration, providing a working reference implementation that developers can use as a template for building their own applications on EVVM with FHE.

**Commit message**: `feat: Complete EVVMCafe integration with documentation and helper functions`

---

## 📊 Updated Progress Summary

| Step | Main Functionality | Dependencies |
|------|-------------------|--------------|
| 1 | Base structure | None |
| 2 | Virtual accounts | Step 1 |
| 3 | Transfers | Step 2 |
| 4 | Virtual blocks | Step 3 |
| 4B | State commitment calc | Step 4 (off-chain) |
| 5 | Transaction registry | Step 3 |
| 6 | Batch transfers | Step 3, 5 |
| 7 | Utilities | Step 2, 3 |
| 8 | Block management | Step 4 |
| 9 | Admin/Testing | All previous |
| 10 | Documentation | All previous |
| 13 | Address compatibility | Step 2, 3 |
| 14 | EVVMCafe contract | Step 13 |
| 15 | Integration docs | Step 14 |

---

## 🔮 Future Extensions (Post-MVP)

- Signature validation for transactions
- Validator system
- Multiple tokens per account
- NameService integration
- Staking system
- Treasury functions
- Cross-chain bridge (Fisher Bridge)
- Advanced signature schemes for EVVMCafe (EIP-712, EIP-191)
- **Async nonces support** - Allow nonces to be used out of order (see Step 5B below)

---

## 📋 Step 5B: Async Nonces Support (Future Enhancement)

**Objective**: Add support for async (out-of-order) nonces while maintaining sync nonces as default.

**Files to create/modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Features to add**:

- `mapping(bytes32 => mapping(uint64 => bool)) private usedNonces` - track which nonces have been used per account
- `bool public asyncNoncesEnabled` - flag to enable/disable async nonces globally
- `mapping(bytes32 => bool) public accountAsyncNoncesEnabled` - per-account async nonce flag
- Modify `applyTransfer()` to support both sync and async nonce validation
- Add `enableAsyncNonces(bytes32 vaddr)` - allow a specific account to use async nonces
- Update `VirtualAccount` struct to track highest nonce used (optional)

**Key code structure**:

```solidity
// State variables
mapping(bytes32 => mapping(uint64 => bool)) private usedNonces;
bool public asyncNoncesEnabled; // Global flag
mapping(bytes32 => bool) public accountAsyncNoncesEnabled; // Per-account flag

// In applyTransfer(), replace nonce validation:
if (asyncNoncesEnabled && accountAsyncNoncesEnabled[fromVaddr]) {
    // Async nonce: check if already used
    require(!usedNonces[fromVaddr][expectedNonce], "EVVM: nonce already used");
    usedNonces[fromVaddr][expectedNonce] = true;
    
    // Update highest nonce used (optional, for reference)
    if (expectedNonce > fromAcc.nonce) {
        fromAcc.nonce = expectedNonce;
    }
} else {
    // Sync nonce: must be sequential
    require(fromAcc.nonce == expectedNonce, "EVVM: bad nonce");
    fromAcc.nonce += 1;
}

// New function
function enableAsyncNonces(bytes32 vaddr) external {
    require(accounts[vaddr].exists, "EVVM: account does not exist");
    // Only account owner or contract owner can enable
    // (requires signature validation or ownership check)
    accountAsyncNoncesEnabled[vaddr] = true;
}
```

**Why Async Nonces?**

1. **Parallel Transaction Processing**: 
   - Users can submit multiple transactions simultaneously with different nonces
   - No need to wait for previous transactions to be confirmed
   - Useful for high-frequency trading or batch operations

2. **Network Congestion Handling**:
   - If transaction with nonce 5 arrives before nonce 4, it can still be processed
   - Reduces failed transactions due to out-of-order arrival

3. **Flexibility**:
   - Some use cases require out-of-order execution
   - Maintains backward compatibility with sync nonces as default

**Trade-offs**:

- **Storage Cost**: Requires additional mapping to track used nonces
- **Gas Cost**: Slightly higher gas per transaction (checking mapping)
- **Complexity**: More complex validation logic

**Context**: This enhancement allows users to submit transactions with nonces out of order, which is useful for parallel processing and handling network congestion. The system maintains backward compatibility by keeping sync nonces as the default behavior.

**Commit message**: `feat: Add async nonces support for out-of-order transaction processing`
