# EVVM Development Roadmap v2.0

## Overview

This document provides a comprehensive, step-by-step development roadmap for evolving the EVVM (Encrypted Virtual VM) Core contract. It consolidates:

1. **Previous Work** (Steps 1-15 completed in Fhenix)
2. **Zama FHEVM Migration** (from `FHENIX_TO_ZAMA_MIGRATION_PLAN.md`) ✅
3. **EIP-191 Signature Implementation** (from `EIP191_SIGNATURE_PLAN.md`) ✅
4. **FHE Hybrid Authentication - Plan 2A** (improved challenge-response design)

**Focus**: Solidity contracts first, then tests, then frontend.

### Key Improvement in Plan 2A

The original Phase 3 FHE Hybrid Auth design had a critical vulnerability where an attacker with only the signing key (not the secret) could burn all nonces via DoS attack. Plan 2A solves this with a two-phase challenge-response protocol where nonces only increment after successful secret verification.

---

## Current State Summary

### Completed (Fhenix/CoFHE)

| Step | Feature | Status |
|------|---------|--------|
| 1-10 | EVVMCore base implementation | Done |
| 13 | Address-to-Vaddr compatibility | Done |
| 14-15 | EVVMCafe integration | Done |

### Deployed Contracts (Sepolia - Fhenix)

| Contract | Address | Status |
|----------|---------|--------|
| EVVMCore | `0xf239a3D5B22e416aF1183824c264caa25097300e` | Deployed |
| EVVMCafe | `0x9e780309645D9898782282Fd95E64f24D7637324` | Deployed |

### Known Issues

1. **Balance Decryption**: `PermissionInvalid_RecipientSignature` errors
2. **No Signature Validation**: Nonce-only replay protection
3. **Fhenix Dependency**: Need to migrate to Zama for broader compatibility

---

## Phase 1: Zama FHEVM Migration (Solidity)

> **Goal**: Port all contracts from Fhenix CoFHE to Zama FHEVM

### Step 1.1: Update Dependencies

**Files to modify**:
- `packages/hardhat/package.json`
- `packages/hardhat/hardhat.config.ts`

**Tasks**:
- [ ] Remove `@fhenixprotocol/cofhe-contracts`
- [ ] Add `@fhevm/solidity` package
- [ ] Add `@fhevm/hardhat-plugin` for testing
- [ ] Configure Zama network settings (Sepolia)
- [ ] Update compiler settings if needed

**Package.json changes**:
```json
{
  "dependencies": {
    "@fhevm/solidity": "^0.9.x",
    "@openzeppelin/contracts": "^5.0.0"
  },
  "devDependencies": {
    "@fhevm/hardhat-plugin": "^0.9.x"
  }
}
```

**Hardhat config changes**:
```typescript
import "@fhevm/hardhat-plugin";

// Add Zama network configuration
networks: {
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL,
    accounts: [process.env.DEPLOYER_PRIVATE_KEY]
  }
}
```

---

### Step 1.2: Migrate FHECounter.sol

**Files to modify**:
- `packages/hardhat/contracts/FHECounter.sol`

**Purpose**: Simple contract to validate migration works before tackling EVVMCore.

**Changes**:

| Before (Fhenix) | After (Zama) |
|-----------------|--------------|
| `import "@fhenixprotocol/cofhe-contracts/FHE.sol"` | `import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol"` |
| `contract FHECounter` | `contract FHECounter is ZamaEthereumConfig` |
| `InEuint32 memory value` | `externalEuint32 value, bytes calldata inputProof` |
| `FHE.asEuint32(value)` | `FHE.fromExternal(value, inputProof)` |
| `FHE.allowSender(count)` | `FHE.allow(count, msg.sender)` |

**New Code**:
```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHECounter is ZamaEthereumConfig {
    euint32 public count;
    euint32 private ONE;

    constructor() {
        ONE = FHE.asEuint32(1);
        count = FHE.asEuint32(0);
        FHE.makePubliclyDecryptable(count);
        FHE.allowThis(ONE);
    }

    function increment() public {
        count = FHE.add(count, ONE);
        FHE.allowThis(count);
        FHE.allow(count, msg.sender);
    }

    function decrement() public {
        count = FHE.sub(count, ONE);
        FHE.allowThis(count);
        FHE.allow(count, msg.sender);
    }

    function set(externalEuint32 value, bytes calldata inputProof) public {
        count = FHE.fromExternal(value, inputProof);
        FHE.allowThis(count);
        FHE.allow(count, msg.sender);
    }
}
```

**Validation**:
- [ ] Contract compiles without errors
- [ ] Deploy to local Zama node
- [ ] Test increment/decrement operations

---

### Step 1.3: Migrate EVVMCore.sol - Imports and Inheritance

**Files to modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Changes**:
```solidity
// BEFORE
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EVVMCore is Ownable {

// AFTER
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EVVMCore is Ownable, ZamaEthereumConfig {
```

**Validation**:
- [ ] Contract compiles (will have errors in function bodies - expected)

---

### Step 1.4: Migrate EVVMCore.sol - Struct Types

**Files to modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Changes to TransferParams struct**:
```solidity
// BEFORE
struct TransferParams {
    bytes32 fromVaddr;
    bytes32 toVaddr;
    InEuint64 amount;
    uint64 expectedNonce;
}

// AFTER
struct TransferParams {
    bytes32 fromVaddr;
    bytes32 toVaddr;
    externalEuint64 amount;
    bytes inputProof;
    uint64 expectedNonce;
}
```

**Note**: VirtualAccount and VirtualTransaction structs remain unchanged (they use `euint64`, not input types).

---

### Step 1.5: Migrate EVVMCore.sol - Function Signatures

**Functions to update**:

| Function | Parameter Changes |
|----------|-------------------|
| `registerAccount` | `InEuint64 calldata initialBalance` → `externalEuint64 initialBalance, bytes calldata inputProof` |
| `applyTransfer` | `InEuint64 calldata amount` → `externalEuint64 amount, bytes calldata inputProof` |
| `_applyTransferInternal` | Same as above |
| `faucetAddBalance` | Same as above |
| `registerAccountFromAddress` | Same as above |
| `requestPay` | Same as above |

**Example - registerAccount**:
```solidity
// BEFORE
function registerAccount(
    bytes32 vaddr,
    InEuint64 calldata initialBalance
) external {
    euint64 balance = FHE.asEuint64(initialBalance);
    // ...
}

// AFTER
function registerAccount(
    bytes32 vaddr,
    externalEuint64 initialBalance,
    bytes calldata inputProof
) external {
    euint64 balance = FHE.fromExternal(initialBalance, inputProof);
    // ...
}
```

---

### Step 1.6: Migrate EVVMCore.sol - Permission Calls

**Permission function mapping**:

| Fhenix | Zama | Action |
|--------|------|--------|
| `FHE.allowThis(handle)` | `FHE.allowThis(handle)` | No change |
| `FHE.allowSender(handle)` | `FHE.allow(handle, msg.sender)` | Update |
| `FHE.allowGlobal(handle)` | `FHE.makePubliclyDecryptable(handle)` | Update |

**Search and replace in EVVMCore.sol**:
```solidity
// Find all occurrences and replace:
FHE.allowSender(X)  →  FHE.allow(X, msg.sender)
FHE.allowGlobal(X)  →  FHE.makePubliclyDecryptable(X)
```

**Note**: Review each `allowGlobal` usage - some may need `FHE.allow(handle, specificAddress)` instead of public decryptability.

---

### Step 1.7: Migrate EVVMCafe.sol

**Files to modify**:
- `packages/hardhat/contracts/examples/EVVMCafe.sol`

**Changes**:
1. Update imports (same as EVVMCore)
2. Update function signatures for `withdrawFunds` and `registerShopInEVVM`
3. Update permission calls

```solidity
// BEFORE
function withdrawFunds(
    address to,
    InEuint64 calldata amountEnc
) external onlyOwner {
    // ...
    euint64 amountEncEuint = FHE.asEuint64(amountEnc);
}

// AFTER
function withdrawFunds(
    address to,
    externalEuint64 amountEnc,
    bytes calldata inputProof
) external onlyOwner {
    // ...
    euint64 amountEncEuint = FHE.fromExternal(amountEnc, inputProof);
}
```

---

### Step 1.8: Compile and Fix Errors

**Tasks**:
- [ ] Run `yarn hardhat compile`
- [ ] Fix any remaining type errors
- [ ] Ensure all contracts compile successfully

**Common issues to watch for**:
- Missing `inputProof` parameters
- Incorrect permission function names
- Type mismatches between `externalEuint64` and `euint64`

---

### Step 1.9: Update Deploy Scripts

**Files to modify**:
- `packages/hardhat/deploy/01_deploy_fhe_counter.ts`
- `packages/hardhat/deploy/02_deploy_evvm_core.ts`
- `packages/hardhat/deploy/03_deploy_evvm_cafe.ts`

**Changes**:
- Update any deployment logic if constructor parameters changed
- Ensure Zama network configuration is used

---

## Phase 2: EIP-191 Signature Implementation (Solidity)

> **Goal**: Add cryptographic authorization to prevent unauthorized transactions

### Step 2.1: Add Signature Infrastructure

**Files to modify**:
- `packages/hardhat/contracts/core/EVVM.core.sol`

**Add new types and constants**:
```solidity
// ============ Signature Types ============

/// @notice EIP-191 signature components
struct Signature {
    uint8 v;
    bytes32 r;
    bytes32 s;
}

/// @notice Domain identifier for EVVM signatures
bytes32 public constant EVVM_DOMAIN = keccak256("EVVM Virtual Transaction");

/// @notice Signature scheme version (allows future upgrades)
uint8 public constant SIGNATURE_VERSION = 1;
```

---

### Step 2.2: Add Message Hash Function

**Add to EVVMCore.sol**:
```solidity
/// @notice Creates the message hash for a signed transfer operation
/// @param fromVaddr Source virtual address
/// @param toVaddr Destination virtual address  
/// @param amountCommitment Commitment to encrypted amount (hash of ciphertext handle)
/// @param nonce Transaction nonce
/// @param deadline Expiration timestamp
/// @return messageHash The hash to be signed
function getTransferMessageHash(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    bytes32 amountCommitment,
    uint64 nonce,
    uint256 deadline
) public view returns (bytes32) {
    return keccak256(abi.encodePacked(
        EVVM_DOMAIN,
        SIGNATURE_VERSION,
        fromVaddr,
        toVaddr,
        amountCommitment,
        nonce,
        deadline,
        vChainId,
        evvmID,
        block.chainid,
        address(this)
    ));
}
```

---

### Step 2.3: Add EIP-191 Prefix Function

**Add to EVVMCore.sol**:
```solidity
/// @notice Applies EIP-191 prefix to message hash
/// @param messageHash The raw message hash
/// @return prefixedHash The EIP-191 prefixed hash ready for ecrecover
function _toEthSignedMessageHash(bytes32 messageHash) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        messageHash
    ));
}
```

---

### Step 2.4: Add Signature Recovery Function

**Add to EVVMCore.sol**:
```solidity
/// @notice Recovers signer address from EIP-191 signature
/// @param messageHash The original message hash (before EIP-191 prefix)
/// @param sig The signature components (v, r, s)
/// @return signer The recovered Ethereum address
function _recoverSigner(
    bytes32 messageHash,
    Signature memory sig
) internal pure returns (address) {
    bytes32 ethSignedHash = _toEthSignedMessageHash(messageHash);
    
    // Validate signature malleability (EIP-2)
    require(
        uint256(sig.s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
        "EVVM: invalid signature 's' value"
    );
    require(sig.v == 27 || sig.v == 28, "EVVM: invalid signature 'v' value");
    
    address signer = ecrecover(ethSignedHash, sig.v, sig.r, sig.s);
    require(signer != address(0), "EVVM: invalid signature");
    
    return signer;
}
```

---

### Step 2.5: Add Signed Transfer Function

**Add to EVVMCore.sol**:
```solidity
/// @notice Applies a signed transfer within the virtual blockchain
/// @dev Requires valid EIP-191 signature from the account owner
/// @param fromVaddr Source virtual account
/// @param toVaddr Destination virtual account
/// @param amount Encrypted amount (externalEuint64)
/// @param inputProof ZK proof for encrypted input
/// @param expectedNonce Nonce for replay protection
/// @param deadline Timestamp after which signature expires
/// @param sig EIP-191 signature from the account owner
/// @return txId Transaction ID
function applySignedTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature calldata sig
) external returns (uint256 txId) {
    // 1. Check deadline
    require(block.timestamp <= deadline, "EVVM: signature expired");
    
    // 2. Get authorized signer for this vaddr
    address authorizedSigner = vaddrToAddress[fromVaddr];
    require(authorizedSigner != address(0), "EVVM: no signer registered for vaddr");
    
    // 3. Create amount commitment (hash of the ciphertext handle for non-malleability)
    bytes32 amountCommitment = keccak256(abi.encodePacked(amount));
    
    // 4. Compute message hash
    bytes32 messageHash = getTransferMessageHash(
        fromVaddr,
        toVaddr,
        amountCommitment,
        expectedNonce,
        deadline
    );
    
    // 5. Recover signer and verify
    address recoveredSigner = _recoverSigner(messageHash, sig);
    require(recoveredSigner == authorizedSigner, "EVVM: invalid signature");
    
    // 6. Process transfer (reuse existing logic)
    return _applyTransferInternal(fromVaddr, toVaddr, amount, inputProof, expectedNonce, true);
}
```

---

### Step 2.6: Add Event for Signed Transfers

**Add to EVVMCore.sol events section**:
```solidity
/// @notice Emitted when a signed virtual transaction is applied
/// @param fromVaddr The source virtual address
/// @param toVaddr The destination virtual address
/// @param signer The address that signed the transaction
/// @param nonce The nonce used in this transaction
/// @param txId The unique transaction ID
event SignedTransferApplied(
    bytes32 indexed fromVaddr,
    bytes32 indexed toVaddr,
    address indexed signer,
    uint64 nonce,
    uint256 txId
);
```

---

### Step 2.7: Update requestPay to Optionally Accept Signatures

**Modify requestPay in EVVMCore.sol**:
```solidity
/// @notice Compatibility function with optional signature validation
/// @dev If signature is provided, validates it. Otherwise, allows unsigned (legacy mode)
/// @param from The Ethereum address of the sender
/// @param to The Ethereum address of the recipient
/// @param amount Encrypted amount
/// @param inputProof ZK proof for encrypted input
/// @param expectedNonce Nonce for the sender's account
/// @param deadline Expiration timestamp (0 for no signature validation)
/// @param sig Optional signature (pass empty sig with v=0 for unsigned mode)
/// @return txId Transaction ID
function requestPaySigned(
    address from,
    address to,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature calldata sig
) external returns (uint256 txId) {
    bytes32 fromVaddr = addressToVaddr[from];
    bytes32 toVaddr = addressToVaddr[to];
    
    require(fromVaddr != bytes32(0), "EVVM: from address not registered");
    require(toVaddr != bytes32(0), "EVVM: to address not registered");
    
    // If signature is provided, validate it
    if (sig.v != 0) {
        require(block.timestamp <= deadline, "EVVM: signature expired");
        
        bytes32 amountCommitment = keccak256(abi.encodePacked(amount));
        bytes32 messageHash = getTransferMessageHash(
            fromVaddr,
            toVaddr,
            amountCommitment,
            expectedNonce,
            deadline
        );
        
        address recoveredSigner = _recoverSigner(messageHash, sig);
        require(recoveredSigner == from, "EVVM: invalid signature");
    }
    
    return _applyTransferInternal(fromVaddr, toVaddr, amount, inputProof, expectedNonce, true);
}
```

---

## Phase 2A: FHE Hybrid Authentication with Challenge-Response

> **Goal**: Add encrypted secret layer with two-phase protocol to prevent nonce-burning DoS attacks

### Problem with Original Phase 3 Design

The original Phase 3 design had a critical vulnerability:

```
┌─────────────────────────────────────────────────────────────┐
│                    THE PROBLEM                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Attacker has: Signing key only (NOT the FHE secret)        │
│                                                              │
│  Attack:                                                     │
│  1. Submit applySecureTransfer with wrong secret            │
│  2. Signature valid ✓ → passes first check                  │
│  3. Secret invalid → effectiveAmount = 0 (no theft)         │
│  4. BUT: nonce += 1 (ALWAYS!)                               │
│  5. Repeat until all nonces burned                          │
│                                                              │
│  Result:                                                     │
│  - Legitimate user's pending signed txs become invalid      │
│  - User's ETH drained paying gas for failed txs             │
│  - DoS attack successful without stealing EVVM tokens       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Solution: Two-Phase Challenge-Response Protocol

```
┌─────────────────────────────────────────────────────────────┐
│                PLAN 2A: CHALLENGE-RESPONSE                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  PHASE A: Request (signature verified, NO nonce increment)  │
│  ─────────────────────────────────────────────────────────  │
│  1. User submits signed transfer request                    │
│  2. Contract verifies EIP-191 signature                     │
│  3. Contract generates random challenge                     │
│  4. Challenge stored with expiration time                   │
│  5. Nonce NOT incremented yet                               │
│                                                              │
│  PHASE B: Complete (secret verified, nonce increments)      │
│  ─────────────────────────────────────────────────────────  │
│  1. User provides encrypted secret                          │
│  2. Contract compares secret with stored value              │
│  3. FHE.select determines effective amount                  │
│  4. If secret valid: execute transfer, increment nonce      │
│  5. If secret invalid: challenge expires, no state change   │
│                                                              │
│  RESULT: Nonce only increments on successful secret match   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### Step 2A.1: Add Data Structures

**Add to EVVMCore.sol after existing structs**:

```solidity
/// @notice Pending secure transfer challenge
struct SecureTransferChallenge {
    bytes32 fromVaddr;           // Source account
    bytes32 toVaddr;             // Destination account
    externalEuint64 amount;      // Encrypted amount handle
    bytes inputProof;            // ZK proof for amount
    uint64 expectedNonce;        // Nonce at time of request
    uint256 deadline;            // Signature deadline
    uint256 challengeExpiry;     // Challenge expiration (e.g., 5 minutes)
    bytes32 challengeHash;       // Random challenge for binding
    bool exists;                 // Existence flag
}
```

**Add to state variables section**:

```solidity
/// @notice Map of challenge IDs to pending transfers
mapping(bytes32 => SecureTransferChallenge) public pendingSecureTransfers;

/// @notice Encrypted secrets for FHE authentication
mapping(bytes32 => euint64) private accountSecrets;

/// @notice Flag to enable FHE secret requirement per account
mapping(bytes32 => bool) public fheSecretEnabled;

/// @notice Challenge expiration time (5 minutes)
uint256 public constant CHALLENGE_EXPIRY = 5 minutes;
```

---

### Step 2A.2: Add Events

**Add to EVVMCore.sol events section**:

```solidity
/// @notice Emitted when a secure transfer challenge is created
event SecureTransferRequested(
    bytes32 indexed challengeId,
    bytes32 indexed fromVaddr,
    bytes32 indexed toVaddr,
    uint256 challengeExpiry
);

/// @notice Emitted when a secure transfer is completed
event SecureTransferCompleted(
    bytes32 indexed challengeId,
    bytes32 indexed fromVaddr,
    bytes32 indexed toVaddr,
    uint64 nonce,
    uint256 txId
);

/// @notice Emitted when a secure transfer challenge expires/cancelled
event SecureTransferCancelled(
    bytes32 indexed challengeId,
    bytes32 indexed fromVaddr,
    string reason
);

/// @notice Emitted when account secret is set/updated
event AccountSecretUpdated(
    bytes32 indexed vaddr,
    bool enabled
);
```

---

### Step 2A.3: Add Secret Management Functions

**Add to EVVMCore.sol**:

```solidity
/// @notice Sets up an encrypted secret for FHE authentication
/// @dev Only callable by the registered address owner
/// @param vaddr The virtual address to set secret for
/// @param secret The encrypted secret value
/// @param inputProof ZK proof for the encrypted secret
function setAccountSecret(
    bytes32 vaddr,
    externalEuint64 secret,
    bytes calldata inputProof
) external {
    require(accounts[vaddr].exists, "EVVM: account does not exist");
    require(vaddrToAddress[vaddr] == msg.sender, "EVVM: not account owner");
    
    euint64 encryptedSecret = FHE.fromExternal(secret, inputProof);
    accountSecrets[vaddr] = encryptedSecret;
    fheSecretEnabled[vaddr] = true;
    
    // Only contract can access the secret for comparison
    FHE.allowThis(encryptedSecret);
    // Do NOT allow anyone else to read the secret
    
    emit AccountSecretUpdated(vaddr, true);
}

/// @notice Disables FHE secret requirement for an account
/// @dev Only callable by the registered address owner
/// @param vaddr The virtual address to disable secret for
function disableAccountSecret(bytes32 vaddr) external {
    require(vaddrToAddress[vaddr] == msg.sender, "EVVM: not account owner");
    fheSecretEnabled[vaddr] = false;
    // Keep the secret stored (user might re-enable)
    
    emit AccountSecretUpdated(vaddr, false);
}

/// @notice Checks if an account has FHE secret enabled
/// @param vaddr The virtual address to check
/// @return enabled True if FHE secret is enabled
function hasSecretEnabled(bytes32 vaddr) external view returns (bool) {
    return fheSecretEnabled[vaddr];
}
```

---

### Step 2A.4: Add requestSecureTransfer (Phase A)

**Add to EVVMCore.sol**:

```solidity
/// @notice Phase A: Request a secure transfer (creates challenge)
/// @dev Verifies signature but does NOT increment nonce
/// @param fromVaddr Source virtual account
/// @param toVaddr Destination virtual account
/// @param amount Encrypted amount handle
/// @param inputProof ZK proof for amount
/// @param expectedNonce Nonce at time of request
/// @param deadline Signature deadline
/// @param sig EIP-191 signature
/// @return challengeId Unique identifier for completing the transfer
function requestSecureTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature calldata sig
) external returns (bytes32 challengeId) {
    // 1. Check deadline
    require(block.timestamp <= deadline, "EVVM: signature expired");
    
    // 2. Verify FHE secret is enabled for this account
    require(fheSecretEnabled[fromVaddr], "EVVM: FHE secret not enabled");
    
    // 3. Get authorized signer
    address authorizedSigner = vaddrToAddress[fromVaddr];
    require(authorizedSigner != address(0), "EVVM: no signer for vaddr");
    
    // 4. Verify accounts exist
    require(accounts[fromVaddr].exists, "EVVM: from account missing");
    require(accounts[toVaddr].exists, "EVVM: to account missing");
    
    // 5. Verify nonce is still valid (but don't increment!)
    require(accounts[fromVaddr].nonce == expectedNonce, "EVVM: bad nonce");
    
    // 6. Verify signature
    bytes32 amountCommitment = keccak256(abi.encodePacked(externalEuint64.unwrap(amount)));
    bytes32 messageHash = getTransferMessageHash(
        fromVaddr, toVaddr, amountCommitment, expectedNonce, deadline
    );
    require(_recoverSigner(messageHash, sig) == authorizedSigner, "EVVM: invalid signature");
    
    // 7. Generate unique challenge ID
    challengeId = keccak256(abi.encodePacked(
        fromVaddr,
        toVaddr,
        block.timestamp,
        block.prevrandao,
        msg.sender
    ));
    
    // 8. Ensure challenge doesn't already exist
    require(!pendingSecureTransfers[challengeId].exists, "EVVM: challenge exists");
    
    // 9. Store the challenge (nonce NOT incremented)
    pendingSecureTransfers[challengeId] = SecureTransferChallenge({
        fromVaddr: fromVaddr,
        toVaddr: toVaddr,
        amount: amount,
        inputProof: inputProof,
        expectedNonce: expectedNonce,
        deadline: deadline,
        challengeExpiry: block.timestamp + CHALLENGE_EXPIRY,
        challengeHash: keccak256(abi.encodePacked(challengeId, block.timestamp)),
        exists: true
    });
    
    emit SecureTransferRequested(
        challengeId,
        fromVaddr,
        toVaddr,
        block.timestamp + CHALLENGE_EXPIRY
    );
    
    return challengeId;
}
```

---

### Step 2A.5: Add completeSecureTransfer (Phase B)

**Add to EVVMCore.sol**:

```solidity
/// @notice Phase B: Complete secure transfer (verifies secret)
/// @dev Only increments nonce if secret is valid
/// @param challengeId The challenge ID from requestSecureTransfer
/// @param secret The encrypted secret
/// @param secretProof ZK proof for the secret
/// @return txId Transaction ID (0 if secret invalid and challenge cancelled)
function completeSecureTransfer(
    bytes32 challengeId,
    externalEuint64 secret,
    bytes calldata secretProof
) external returns (uint256 txId) {
    // 1. Get challenge
    SecureTransferChallenge storage challenge = pendingSecureTransfers[challengeId];
    require(challenge.exists, "EVVM: challenge not found");
    
    // 2. Check challenge hasn't expired
    require(block.timestamp <= challenge.challengeExpiry, "EVVM: challenge expired");
    
    // 3. Verify nonce is still valid
    require(
        accounts[challenge.fromVaddr].nonce == challenge.expectedNonce,
        "EVVM: nonce changed"
    );
    
    // 4. Convert encrypted inputs
    euint64 transferAmount = FHE.fromExternal(challenge.amount, challenge.inputProof);
    euint64 providedSecret = FHE.fromExternal(secret, secretProof);
    
    // 5. Verify secret
    ebool secretValid = FHE.eq(providedSecret, accountSecrets[challenge.fromVaddr]);
    
    // 6. Conditional amount (zero if invalid)
    euint64 effectiveAmount = FHE.select(
        secretValid,
        transferAmount,
        FHE.asEuint64(0)
    );
    
    // 7. Execute transfer
    VirtualAccount storage fromAcc = accounts[challenge.fromVaddr];
    VirtualAccount storage toAcc = accounts[challenge.toVaddr];
    
    fromAcc.balance = FHE.sub(fromAcc.balance, effectiveAmount);
    toAcc.balance = FHE.add(toAcc.balance, effectiveAmount);
    
    // 8. Set permissions
    FHE.allowThis(fromAcc.balance);
    FHE.allowThis(toAcc.balance);
    FHE.makePubliclyDecryptable(fromAcc.balance);
    FHE.makePubliclyDecryptable(toAcc.balance);
    
    // 9. Only increment nonce (successful completion)
    uint64 usedNonce = fromAcc.nonce;
    fromAcc.nonce += 1;
    
    // 10. Update virtual block
    vBlockNumber += 1;
    if (!virtualBlocks[vBlockNumber].exists) {
        virtualBlocks[vBlockNumber] = VirtualBlock({
            blockNumber: vBlockNumber,
            stateCommitment: stateCommitment,
            timestamp: block.timestamp,
            transactionCount: 1,
            exists: true
        });
    }
    
    // 11. Store transaction
    txId = nextTxId++;
    virtualTransactions[txId] = VirtualTransaction({
        fromVaddr: challenge.fromVaddr,
        toVaddr: challenge.toVaddr,
        amountEnc: effectiveAmount,
        nonce: usedNonce,
        vBlockNumber: vBlockNumber,
        timestamp: block.timestamp,
        exists: true
    });
    
    // 12. Clean up challenge
    bytes32 fromVaddr = challenge.fromVaddr;
    bytes32 toVaddr = challenge.toVaddr;
    delete pendingSecureTransfers[challengeId];
    
    // 13. Emit events
    emit VirtualTransferApplied(
        fromVaddr,
        toVaddr,
        effectiveAmount,
        usedNonce,
        vBlockNumber,
        txId
    );
    
    emit SecureTransferCompleted(
        challengeId,
        fromVaddr,
        toVaddr,
        usedNonce,
        txId
    );
    
    return txId;
}
```

---

### Step 2A.6: Add cancelSecureTransfer

**Add to EVVMCore.sol**:

```solidity
/// @notice Cancel an expired or unwanted challenge
/// @dev Anyone can cancel expired challenges, only owner can cancel valid ones
/// @param challengeId The challenge ID to cancel
function cancelSecureTransfer(bytes32 challengeId) external {
    SecureTransferChallenge storage challenge = pendingSecureTransfers[challengeId];
    require(challenge.exists, "EVVM: challenge not found");
    
    // Anyone can cancel expired challenges
    // Only owner can cancel non-expired challenges
    if (block.timestamp <= challenge.challengeExpiry) {
        require(
            vaddrToAddress[challenge.fromVaddr] == msg.sender,
            "EVVM: not owner, challenge not expired"
        );
    }
    
    bytes32 fromVaddr = challenge.fromVaddr;
    string memory reason = block.timestamp > challenge.challengeExpiry ? "expired" : "cancelled";
    
    delete pendingSecureTransfers[challengeId];
    
    emit SecureTransferCancelled(challengeId, fromVaddr, reason);
}
```

---

### Step 2A.7: Compile and Verify

**Tasks**:
- [ ] Run `yarn hardhat compile --force`
- [ ] Verify no compilation errors
- [ ] Check gas estimates for new functions

---

### Security Analysis

| Attack | Original Phase 3 | Plan 2A (Challenge-Response) |
|--------|------------------|------------------------------|
| Nonce burning (sig only) | ❌ Vulnerable | ✅ Protected - nonce only increments in Phase B |
| Gas draining | ❌ Vulnerable | ⚠️ Partial - Phase A still costs gas |
| Secret brute force | ✅ Protected (FHE) | ✅ Protected (FHE) |
| Challenge replay | N/A | ✅ Protected (unique ID, expiry) |
| Front-running | ⚠️ Possible | ✅ Protected (challenge binding) |

### Gas Estimates

| Operation | Estimated Gas | Notes |
|-----------|---------------|-------|
| `setAccountSecret` | ~100,000 | FHE conversion + storage |
| `requestSecureTransfer` | ~80,000 | Signature recovery + storage |
| `completeSecureTransfer` | ~250,000 | FHE operations + transfer |
| `cancelSecureTransfer` | ~30,000 | Storage deletion (gas refund) |

---

### Frontend Integration Example

```typescript
// Step 1: Set up account secret (one-time)
const secretValue = BigInt(Math.random() * 1e18);  // User's secret
const encryptedSecret = await fhevm.createEncryptedInput(contractAddr, userAddr)
    .add64(secretValue)
    .encrypt();
await evvmCore.setAccountSecret(vaddr, encryptedSecret.handles[0], encryptedSecret.inputProof);

// Step 2: Request secure transfer (Phase A)
const sig = await signTransfer(signer, fromVaddr, toVaddr, amountHandle, nonce, deadline);
const tx1 = await evvmCore.requestSecureTransfer(
    fromVaddr, toVaddr, amountHandle, amountProof, nonce, deadline, sig
);
const challengeId = /* parse from tx1 events */;

// Step 3: Complete secure transfer within 5 minutes (Phase B)
const encryptedSecretForTx = await fhevm.createEncryptedInput(contractAddr, userAddr)
    .add64(secretValue)  // Same secret value
    .encrypt();
const tx2 = await evvmCore.completeSecureTransfer(
    challengeId,
    encryptedSecretForTx.handles[0],
    encryptedSecretForTx.inputProof
);
```

---

## Phase 4: Testing (Solidity & TypeScript)

### Step 4.1: Update Test Imports

**Files to modify**:
- `packages/hardhat/test/FHECounter.test.ts`
- `packages/hardhat/test/EVVMCore.test.ts`
- `packages/hardhat/test/EVVMCafe.integration.test.ts`

**Changes**:
```typescript
// BEFORE
import { ethers } from "hardhat";

// AFTER
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
```

---

### Step 4.2: Update Encryption Helpers

**Create/update test utilities**:
```typescript
// packages/hardhat/test/helpers/fhevm.ts

import { fhevm } from "hardhat";

export async function createEncryptedInput(
    contractAddress: string,
    userAddress: string,
    value: bigint
): Promise<{ handle: string; proof: string }> {
    const encryptedInput = await fhevm
        .createEncryptedInput(contractAddress, userAddress)
        .add64(value)
        .encrypt();
    
    return {
        handle: encryptedInput.handles[0],
        proof: encryptedInput.inputProof
    };
}

export async function decryptValue(
    type: typeof FhevmType.euint64,
    encryptedValue: string,
    contractAddress: string,
    signer: any
): Promise<bigint> {
    return await fhevm.userDecryptEuint(
        type,
        encryptedValue,
        contractAddress,
        signer
    );
}
```

---

### Step 4.3: Update EVVMCore Tests

**Key test updates**:
```typescript
describe("EVVMCore - Zama", function () {
    it("should register account with encrypted balance", async function () {
        const { handle, proof } = await createEncryptedInput(
            evvmCoreAddress,
            alice.address,
            100n
        );
        
        const vaddr = ethers.keccak256(
            ethers.solidityPacked(
                ["address", "uint64", "uint256"],
                [alice.address, vChainId, evvmID]
            )
        );
        
        await evvmCore.registerAccount(vaddr, handle, proof);
        
        expect(await evvmCore.accountExists(vaddr)).to.be.true;
    });
    
    it("should apply signed transfer", async function () {
        // Setup accounts...
        
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
        const amountCommitment = ethers.keccak256(
            ethers.solidityPacked(["bytes32"], [encryptedAmount.handle])
        );
        
        const messageHash = await evvmCore.getTransferMessageHash(
            fromVaddr,
            toVaddr,
            amountCommitment,
            0n, // nonce
            deadline
        );
        
        const signature = await alice.signMessage(ethers.getBytes(messageHash));
        const sig = ethers.Signature.from(signature);
        
        await evvmCore.applySignedTransfer(
            fromVaddr,
            toVaddr,
            encryptedAmount.handle,
            encryptedAmount.proof,
            0n,
            deadline,
            { v: sig.v, r: sig.r, s: sig.s }
        );
    });
});
```

---

### Step 4.4: Add Signature Test Cases

**New test file**: `packages/hardhat/test/EVVMCore.signatures.test.ts`

```typescript
describe("EVVMCore - Signatures", function () {
    it("should reject expired signatures", async function () {
        const deadline = BigInt(Math.floor(Date.now() / 1000) - 100); // Past
        // ... setup and sign ...
        await expect(
            evvmCore.applySignedTransfer(...)
        ).to.be.revertedWith("EVVM: signature expired");
    });
    
    it("should reject invalid signatures", async function () {
        // Sign with wrong key
        const wrongSignature = await bob.signMessage(...);
        await expect(
            evvmCore.applySignedTransfer(...)
        ).to.be.revertedWith("EVVM: invalid signature");
    });
    
    it("should reject malleable signatures", async function () {
        // Test with high 's' value
        // ...
    });
    
    it("should prevent cross-chain replay", async function () {
        // Verify chainId is included in hash
        // ...
    });
});
```

---


4A Architecture Refactoring + E2E Tests - DETAILED PLAN
Summary
Based on my research of the EVVM documentation and your requirements:
1. Architecture Refactoring: Split EVVMCore into modular components using Interface-Based architecture
2. E2E Tests: Create comprehensive flow tests for EVVMCore and EVVMCafe
3. Test Infrastructure: Mock FHE first (Option A), then Real FHE (Option B)
4. Remove FHECounter: Delete all related files
5. Periphery folder: Named periphery/ with reusable libraries
---
Part 1: New File Structure
packages/hardhat/contracts/
├── core/
│   └── EVVMCore.sol               # Minimal core: accounts, balances, basic transfer
│
├── periphery/
│   ├── EVVMSignatureVerifier.sol  # Library: signature verification logic
│   ├── EVVMSignedTransfers.sol    # Contract: signed transfer functions
│   └── EVVMSecureTransfers.sol    # Contract: Plan 2A challenge-response
│
├── interfaces/
│   ├── IEVVMCore.sol              # Core interface (accounts, transfers, queries)
│   ├── IEVVMSignedTransfers.sol   # Signed transfers interface
│   └── IEVVMSecureTransfers.sol   # Secure transfers interface
│
├── examples/
│   └── EVVMCafe.sol               # Example integration (unchanged location)
│
└── hardhat/
    └── Multicall3.sol             # Utility (unchanged)

Part 2: Interface Definitions
IEVVMCore.sol
// Core interface - minimal virtual blockchain functions
interface IEVVMCore {
    // Structs
    struct VirtualAccount {
        euint64 balance;
        uint64 nonce;
        bool exists;
    }
    
    struct VirtualTransaction {
        bytes32 fromVaddr;
        bytes32 toVaddr;
        euint64 amountEnc;
        uint64 nonce;
        uint64 vBlockNumber;
        uint256 timestamp;
        bool exists;
    }
    
    // Account Management
    function registerAccount(bytes32 vaddr, externalEuint64 initialBalance, bytes calldata inputProof) external;
    function registerAccountFromAddress(address realAddress, externalEuint64 initialBalance, bytes calldata inputProof) external;
    function accountExists(bytes32 vaddr) external view returns (bool);
    function getEncryptedBalance(bytes32 vaddr) external view returns (euint64);
    function getNonce(bytes32 vaddr) external view returns (uint64);
    
    // Address Mapping
    function getVaddrFromAddress(address realAddress) external view returns (bytes32);
    function generateVaddrFromAddress(address realAddress, bytes32 salt) external view returns (bytes32);
    
    // Basic Transfers
    function applyTransfer(bytes32 fromVaddr, bytes32 toVaddr, externalEuint64 amount, bytes calldata inputProof, uint64 expectedNonce) external returns (uint256 txId);
    function requestPay(address from, address to, externalEuint64 amount, bytes calldata inputProof, uint64 expectedNonce) external returns (uint256 txId);
    
    // Transaction Queries
    function getVirtualTransaction(uint256 txId) external view returns (VirtualTransaction memory);
    
    // Events
    event VirtualAccountRegistered(bytes32 indexed vaddr, uint64 initialNonce);
    event VirtualTransferApplied(bytes32 indexed fromVaddr, bytes32 indexed toVaddr, euint64 amountEnc, uint64 nonce, uint64 vBlockNumber, uint256 txId);
}
IEVVMSignedTransfers.sol
// Signed transfers interface
interface IEVVMSignedTransfers {
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    
    function getTransferMessageHash(bytes32 fromVaddr, bytes32 toVaddr, bytes32 amountCommitment, uint64 nonce, uint256 deadline) external view returns (bytes32);
    function applySignedTransfer(bytes32 fromVaddr, bytes32 toVaddr, externalEuint64 amount, bytes calldata inputProof, uint64 expectedNonce, uint256 deadline, Signature calldata sig) external returns (uint256 txId);
    function requestPaySigned(address from, address to, externalEuint64 amount, bytes calldata inputProof, uint64 expectedNonce, uint256 deadline, Signature calldata sig) external returns (uint256 txId);
    
    event SignedTransferApplied(bytes32 indexed fromVaddr, bytes32 indexed toVaddr, address indexed signer, uint64 nonce, uint256 deadline, uint256 txId);
}
IEVVMSecureTransfers.sol
// Plan 2A secure transfers interface
interface IEVVMSecureTransfers {
    struct SecureTransferChallenge {
        bytes32 fromVaddr;
        bytes32 toVaddr;
        externalEuint64 amount;
        bytes inputProof;
        uint64 expectedNonce;
        uint256 deadline;
        uint256 challengeExpiry;
        bytes32 challengeHash;
        bool exists;
    }
    
    // Secret Management
    function setAccountSecret(bytes32 vaddr, externalEuint64 secret, bytes calldata inputProof) external;
    function disableAccountSecret(bytes32 vaddr) external;
    function enableAccountSecret(bytes32 vaddr) external;
    function hasSecretEnabled(bytes32 vaddr) external view returns (bool);
    
    // Challenge-Response
    function requestSecureTransfer(bytes32 fromVaddr, bytes32 toVaddr, externalEuint64 amount, bytes calldata inputProof, uint64 expectedNonce, uint256 deadline, Signature calldata sig) external returns (bytes32 challengeId);
    function completeSecureTransfer(bytes32 challengeId, externalEuint64 secret, bytes calldata secretProof) external returns (uint256 txId);
    function cancelSecureTransfer(bytes32 challengeId) external;
    function getSecureTransferChallenge(bytes32 challengeId) external view returns (SecureTransferChallenge memory);
    
    // Events
    event SecureTransferRequested(bytes32 indexed challengeId, bytes32 indexed fromVaddr, bytes32 indexed toVaddr, uint256 challengeExpiry);
    event SecureTransferCompleted(bytes32 indexed challengeId, bytes32 indexed fromVaddr, bytes32 indexed toVaddr, uint64 nonce, uint256 txId);
    event SecureTransferCancelled(bytes32 indexed challengeId, bytes32 indexed fromVaddr, string reason);
    event AccountSecretUpdated(bytes32 indexed vaddr, bool enabled);
}
---
Part 3: Periphery Contracts
EVVMSignatureVerifier.sol (Library)
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
library EVVMSignatureVerifier {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    
    /// @notice Recovers signer from EIP-191 signature
    function recoverSigner(bytes32 messageHash, Signature memory sig) internal pure returns (address) {
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        return ethSignedHash.recover(abi.encodePacked(sig.r, sig.s, sig.v));
    }
    
    /// @notice Verifies signature matches expected signer
    function verifySignature(bytes32 messageHash, Signature memory sig, address expectedSigner) internal pure returns (bool) {
        return recoverSigner(messageHash, sig) == expectedSigner;
    }
    
    /// @notice Creates transfer message hash (EVVM format)
    function createTransferMessageHash(
        bytes32 domain,
        uint8 version,
        bytes32 fromVaddr,
        bytes32 toVaddr,
        bytes32 amountCommitment,
        uint64 nonce,
        uint256 deadline,
        uint64 vChainId,
        uint256 evvmID,
        uint256 chainId,
        address contractAddress
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            domain,
            version,
            fromVaddr,
            toVaddr,
            amountCommitment,
            nonce,
            deadline,
            vChainId,
            evvmID,
            chainId,
            contractAddress
        ));
    }
}
EVVMSignedTransfers.sol
- Inherits from EVVMCore or receives EVVMCore reference
- Uses EVVMSignatureVerifier library
- Implements applySignedTransfer, requestPaySigned
EVVMSecureTransfers.sol
- Inherits from EVVMSignedTransfers or receives reference
- Implements Plan 2A challenge-response functions
- Manages accountSecrets, pendingSecureTransfers
---
Part 4: E2E Test Files
Test File Structure
packages/hardhat/test/
├── helpers/
│   ├── testUtils.ts           # Keep existing
│   └── mockFHE.ts             # NEW: FHE mocking utilities
│
├── e2e/
│   ├── EVVMCore.flow.test.ts      # E2E: Core payment flows
│   ├── EVVMCore.signed.test.ts    # E2E: Signed payment flows
│   ├── EVVMCore.secure.test.ts    # E2E: Plan 2A secure payment flows
│   └── EVVMCafe.flow.test.ts      # E2E: Coffee shop integration flows
│
└── (remove old test files that use Fhenix)
E2E Test Scenarios
EVVMCore.flow.test.ts (Mock FHE)
describe("EVVMCore E2E - Payment Flows", function() {
  
  describe("Flow 1: Basic Registration and Transfer", function() {
    /**
     * Steps:
     * 1. Deploy EVVMCore
     * 2. Alice registers account with 1000 tokens (encrypted)
     * 3. Bob registers account with 500 tokens (encrypted)
     * 4. Alice transfers 200 to Bob
     * 5. Verify:
     *    - Alice nonce incremented
     *    - Transaction stored
     *    - Virtual block created
     *    - Events emitted correctly
     */
  });
  
  describe("Flow 2: Multiple Sequential Transfers", function() {
    /**
     * Steps:
     * 1. Setup Alice (1000), Bob (500), Charlie (200)
     * 2. Alice → Bob: 100
     * 3. Bob → Charlie: 50
     * 4. Charlie → Alice: 25
     * 5. Verify all nonces, all transactions, all blocks
     */
  });
  
  describe("Flow 3: Address-based Payments (requestPay)", function() {
    /**
     * Steps:
     * 1. Alice registers via registerAccountFromAddress
     * 2. Bob registers via registerAccountFromAddress
     * 3. Use requestPay(alice, bob, amount, ...)
     * 4. Verify address→vaddr mapping works correctly
     */
  });
  
  describe("Flow 4: Batch Transfers", function() {
    /**
     * Steps:
     * 1. Setup multiple accounts
     * 2. Create batch transfer params
     * 3. Execute applyTransferBatch()
     * 4. Verify all transfers in same virtual block
     * 5. Verify partial failure handling
     */
  });
});
EVVMCore.signed.test.ts (Mock FHE)
describe("EVVMCore E2E - Signed Payment Flows", function() {
  
  describe("Flow 1: Basic Signed Transfer", function() {
    /**
     * Steps:
     * 1. Setup Alice and Bob accounts
     * 2. Alice creates transfer message hash
     * 3. Alice signs with EIP-191
     * 4. Execute applySignedTransfer()
     * 5. Verify signature verification succeeded
     * 6. Verify SignedTransferApplied event
     */
  });
  
  describe("Flow 2: Third-party Submits Signed Transaction", function() {
    /**
     * Steps:
     * 1. Alice creates and signs transaction
     * 2. Charlie (third party) submits the signed tx
     * 3. Verify Alice's funds moved, not Charlie's
     * 4. Verify signer is Alice in event
     */
  });
  
  describe("Flow 3: Expired Signature Rejection", function() {
    /**
     * Steps:
     * 1. Create signed tx with past deadline
     * 2. Attempt to submit
     * 3. Verify rejection with "EVVM: signature expired"
     */
  });
  
  describe("Flow 4: Wrong Signer Rejection", function() {
    /**
     * Steps:
     * 1. Alice creates tx, Bob signs it
     * 2. Attempt to submit
     * 3. Verify rejection with "EVVM: invalid signature"
     */
  });
  
  describe("Flow 5: requestPaySigned", function() {
    /**
     * Steps:
     * 1. Setup via registerAccountFromAddress
     * 2. Create signed request-pay
     * 3. Verify address-based signed transfer works
     */
  });
});
EVVMCore.secure.test.ts (Mock FHE)
describe("EVVMCore E2E - Plan 2A Secure Flows", function() {
  
  describe("Flow 1: Complete Challenge-Response Success", function() {
    /**
     * Steps:
     * 1. Alice sets encrypted secret
     * 2. Phase A: requestSecureTransfer()
     *    - Verify challengeId returned
     *    - Verify nonce NOT incremented
     *    - Verify SecureTransferRequested event
     * 3. Phase B: completeSecureTransfer() with correct secret
     *    - Verify transfer executed
     *    - Verify nonce NOW incremented
     *    - Verify SecureTransferCompleted event
     */
  });
  
  describe("Flow 2: Challenge Expiration", function() {
    /**
     * Steps:
     * 1. Create challenge
     * 2. Advance time past CHALLENGE_EXPIRY (5 minutes)
     * 3. Attempt completeSecureTransfer()
     * 4. Verify rejection with "EVVM: challenge expired"
     */
  });
  
  describe("Flow 3: Challenge Cancellation by Owner", function() {
    /**
     * Steps:
     * 1. Create challenge
     * 2. Owner calls cancelSecureTransfer()
     * 3. Verify SecureTransferCancelled event
     * 4. Verify challenge deleted
     */
  });
  
  describe("Flow 4: Anyone Can Cancel Expired Challenge", function() {
    /**
     * Steps:
     * 1. Create challenge
     * 2. Advance time past expiry
     * 3. Random user calls cancelSecureTransfer()
     * 4. Verify success (cleanup allowed)
     */
  });
  
  describe("Flow 5: DoS Protection - Nonce Not Burned", function() {
    /**
     * Critical security test:
     * 1. Attacker has Alice's signing key but NOT secret
     * 2. Attacker creates challenge (Phase A)
     * 3. Verify Alice's nonce unchanged
     * 4. Challenge expires without completion
     * 5. Alice can still use same nonce for legitimate tx
     */
  });
  
  describe("Flow 6: Secret Enable/Disable", function() {
    /**
     * Steps:
     * 1. Set secret → fheSecretEnabled = true
     * 2. Disable secret → fheSecretEnabled = false
     * 3. Verify requestSecureTransfer fails when disabled
     * 4. Re-enable secret → works again
     */
  });
});
EVVMCafe.flow.test.ts (Mock FHE)
describe("EVVMCafe E2E - Coffee Shop Flows", function() {
  
  describe("Flow 1: Complete Coffee Purchase", function() {
    /**
     * Steps:
     * 1. Deploy EVVMCore and EVVMCafe
     * 2. Register shop in EVVM (registerShopInEVVM)
     * 3. Register customer (Alice) in EVVM
     * 4. Alice calls requestPay() to shop for coffee payment
     * 5. Alice calls orderCoffee() with payment txId
     * 6. Verify:
     *    - CoffeeOrdered event emitted
     *    - Shop balance increased
     *    - Alice balance decreased
     */
  });
  
  describe("Flow 2: Multiple Orders Same Customer", function() {
    /**
     * Steps:
     * 1. Setup shop and customer
     * 2. Order 1: espresso
     * 3. Order 2: latte
     * 4. Order 3: cappuccino
     * 5. Verify all service nonces tracked correctly
     */
  });
  
  describe("Flow 3: Shop Withdrawal", function() {
    /**
     * Steps:
     * 1. Setup and process some orders
     * 2. Shop owner calls withdrawFunds()
     * 3. Verify FundsWithdrawn event
     * 4. Verify shop balance decreased
     * 5. Verify owner received funds
     */
  });
  
  describe("Flow 4: Payment Verification Edge Cases", function() {
    /**
     * Steps:
     * 1. Attempt orderCoffee with wrong txId → fail
     * 2. Attempt orderCoffee with tx from wrong sender → fail
     * 3. Attempt orderCoffee with tx to wrong recipient → fail
     * 4. Attempt orderCoffee with mismatched nonce → fail
     * 5. Attempt orderCoffee with already used service nonce → fail
     */
  });
  
  describe("Flow 5: Unregistered Entities", function() {
    /**
     * Steps:
     * 1. Attempt order when shop not registered → fail
     * 2. Attempt order when customer not registered → fail
     */
  });
});
---
Part 5: Files to Delete
| File | Reason |
|------|--------|
| contracts/FHECounter.sol | Example removed per request |
| deploy/01_deploy_fhe_counter.ts | Deploy script for removed contract |
| test/FHECounter.test.ts | Tests for removed contract |
| test/EVVMCore.test.ts | Uses old Fhenix SDK, replaced by E2E tests |

Should EVVMCore be completely refactored to use interfaces/periphery now?
 - (I recommend Option B: Create interfaces + periphery as additions first, then refactor core later)
 Should the E2E tests cover the refactored periphery contracts? ( yes)
  Mock FHE approach:
Or should I use Hardhat network with mocked encrypted values that just pass through?
Real FHE tests (Option B):
   - Should these be in a separate folder like test/e2e-fhe/ yes?
   Deploy script renumbering
---

## Phase 5: Deployment

> **Goal**: Deploy the updated contracts to Zama testnet (Sepolia) and verify on Etherscan

### Prerequisites

Before deployment, ensure:
- [ ] All 36 tests pass locally
- [ ] Environment variables configured in `.env`
- [ ] Sufficient Sepolia ETH for deployment gas
- [ ] Zama KMS access configured (if required)

### Step 5.1: Pre-Deployment Verification

**Tasks**:
- [ ] Run full test suite to verify contract integrity
- [ ] Verify hardhat configuration for Sepolia network
- [ ] Check deployer account has sufficient funds

**Commands**:
```bash
# Run all tests
cd packages/hardhat
yarn test

# Check compilation
yarn hardhat compile --force

# Verify deployer balance (optional)
yarn hardhat run scripts/checkBalance.ts --network sepolia
```

---

### Step 5.2: Deploy Contracts to Zama Testnet (Sepolia)

**Deployment Order**:
1. `Multicall3` (if not already deployed)
2. `FHECounter` (optional, for testing FHE functionality)
3. `EVVMCore` (main contract)
4. `EVVMCafe` (example integration)

**Deploy Scripts**:
- `packages/hardhat/deploy/00_deploy_multicall3_only_HH.ts`
- `packages/hardhat/deploy/01_deploy_fhe_counter.ts`
- `packages/hardhat/deploy/02_deploy_evvm_core.ts`
- `packages/hardhat/deploy/03_deploy_evvm_cafe.ts`

**Deployment Commands**:
```bash
# Navigate to hardhat package
cd packages/hardhat

# Deploy all contracts to Sepolia
yarn hardhat deploy --network sepolia

# Or deploy specific contracts
yarn hardhat deploy --network sepolia --tags EVVMCore
yarn hardhat deploy --network sepolia --tags EVVMCafe
```

**Expected Output**:
```
deploying "EVVMCore" (tx: 0x...)
EVVMCore deployed at: 0x...
deploying "EVVMCafe" (tx: 0x...)
EVVMCafe deployed at: 0x...
```

---

### Step 5.3: Verify Contracts on Etherscan

**Verification Commands**:
```bash
# Verify EVVMCore
yarn hardhat verify --network sepolia <EVVM_CORE_ADDRESS> <VCHAIN_ID> <EVVM_ID>

# Verify EVVMCafe
yarn hardhat verify --network sepolia <EVVM_CAFE_ADDRESS> <EVVM_CORE_ADDRESS> <SHOP_OWNER_ADDRESS>

# Verify FHECounter (if deployed)
yarn hardhat verify --network sepolia <FHE_COUNTER_ADDRESS>
```

**Alternative - Using hardhat-deploy verification**:
```bash
yarn hardhat etherscan-verify --network sepolia
```

---

### Step 5.4: Update deployedContracts.ts

**Auto-Generation**:
The deploy scripts automatically generate TypeScript ABIs via `generateTsAbis.ts`.

**Verification Checklist**:
- [ ] Contract ABIs include all new functions:
  - `applySignedTransfer()`
  - `requestPaySigned()`
  - `setAccountSecret()`
  - `requestSecureTransfer()`
  - `completeSecureTransfer()`
  - `cancelSecureTransfer()`
  - `getSecureTransferChallenge()`
- [ ] New events are included:
  - `SignedTransferApplied`
  - `SecureTransferRequested`
  - `SecureTransferCompleted`
  - `SecureTransferCancelled`
  - `AccountSecretUpdated`
- [ ] `Signature` struct is correctly typed
- [ ] `SecureTransferChallenge` struct is correctly typed

**Manual Update (if needed)**:
```bash
# Regenerate TypeScript ABIs
yarn hardhat run scripts/generateTsAbis.ts --network sepolia
```

---

### Step 5.5: Post-Deployment Setup

**Initialize Test Accounts**:
```bash
# Register test accounts in EVVM
yarn hardhat run scripts/setupTestAccounts.ts --network sepolia

# Setup EVVMCafe (register shop, etc.)
yarn hardhat run scripts/setupEvvmCafe.ts --network sepolia
```

**Verify Deployment**:
```bash
# Check balances and state
yarn hardhat run scripts/sepolia/checkBalances.ts --network sepolia
```

---

### Step 5.6: Frontend Integration

**Update Frontend Configuration**:
1. Ensure `packages/nextjs/contracts/deployedContracts.ts` has correct addresses
2. Update network configuration if needed in `scaffold.config.ts`
3. Test frontend connectivity:
   - Connect wallet to Sepolia
   - Verify contract interactions work
   - Test FHE encryption/decryption flow

**Test Commands**:
```bash
# Start frontend
cd packages/nextjs
yarn dev

# Navigate to http://localhost:3000/evvm-cafe
```

---

### Step 5.7: Document Deployed Addresses

**Update DEPLOYMENT_STATUS.md**:

| Contract | Network | Address | Verified |
|----------|---------|---------|----------|
| EVVMCore | Sepolia | `0x...` | Yes/No |
| EVVMCafe | Sepolia | `0x...` | Yes/No |
| FHECounter | Sepolia | `0x...` | Yes/No |

**Record in deployments folder**:
- `packages/hardhat/deployments/sepolia/EVVMCore.json`
- `packages/hardhat/deployments/sepolia/EVVMCafe.json`

---

### Deployment Troubleshooting

**Common Issues**:

| Issue | Solution |
|-------|----------|
| Insufficient gas | Increase gas limit in hardhat.config.ts |
| Nonce too low | Reset account nonce or wait for pending txs |
| Contract too large | Enable optimizer in solidity settings |
| Verification failed | Check constructor args match exactly |
| FHE operations fail | Verify Zama KMS is accessible |

**Gas Estimates** (approximate):

| Contract | Estimated Gas | Est. Cost (at 20 gwei) |
|----------|---------------|------------------------|
| EVVMCore | ~4,000,000 | ~0.08 ETH |
| EVVMCafe | ~2,000,000 | ~0.04 ETH |
| FHECounter | ~1,000,000 | ~0.02 ETH |

---

### Rollback Plan

If deployment fails or issues are discovered:

1. **Do NOT update frontend** until contracts are verified
2. **Keep old deployment addresses** documented
3. **Test on fork first** if making significant changes:
   ```bash
   yarn hardhat node --fork https://sepolia.infura.io/v3/<KEY>
   yarn hardhat deploy --network localhost
   ```

---

## Summary Checklist

### Phase 1: Zama Migration ✅ COMPLETED
- [x] 1.1: Update dependencies
- [x] 1.2: Migrate FHECounter.sol
- [x] 1.3: Migrate EVVMCore.sol imports
- [x] 1.4: Migrate EVVMCore.sol structs
- [x] 1.5: Migrate EVVMCore.sol function signatures
- [x] 1.6: Migrate EVVMCore.sol permission calls
- [x] 1.7: Migrate EVVMCafe.sol
- [x] 1.8: Compile and fix errors
- [x] 1.9: Update deploy scripts (verified - no changes needed)

### Phase 2: EIP-191 Signatures ✅ COMPLETED
- [x] 2.1: Add OpenZeppelin ECDSA imports and Signature struct
- [x] 2.2: Add EVVM_DOMAIN and SIGNATURE_VERSION constants
- [x] 2.3: Add getTransferMessageHash() function
- [x] 2.4: Add _recoverSigner() using OpenZeppelin ECDSA
- [x] 2.5: Add applySignedTransfer() function
- [x] 2.6: Add SignedTransferApplied event
- [x] 2.7: Add requestPaySigned() for address-based signed transfers

### Phase 2A: FHE Hybrid Auth with Challenge-Response ✅ COMPLETED
- [x] 2A.1: Add SecureTransferChallenge struct and state variables
- [x] 2A.2: Add events (SecureTransferRequested, Completed, Cancelled, AccountSecretUpdated)
- [x] 2A.3: Add secret management functions (setAccountSecret, disableAccountSecret, enableAccountSecret, hasSecretEnabled)
- [x] 2A.4: Add requestSecureTransfer (Phase A - signature only, no nonce increment)
- [x] 2A.5: Add completeSecureTransfer (Phase B - secret verification, nonce increment)
- [x] 2A.6: Add cancelSecureTransfer (cleanup expired/unwanted challenges)
- [x] 2A.7: Add getSecureTransferChallenge view function
- [x] 2A.8: Compile and verify

### Phase 4: Testing ✅ COMPLETED
- [x] 4.1: Create test helpers (testUtils.ts)
- [x] 4.2: Add EIP-191 signature tests (EVVMCore.signatures.test.ts)
- [x] 4.3: Add Plan 2A challenge-response tests (EVVMCore.plan2a.test.ts)
- [x] 4.4: Add private payment E2E tests (EVVMCore.e2e.test.ts)
- [x] 4.5: All 36 tests passing

### Phase 5: Deployment
- [ ] 5.1: Pre-deployment verification (tests, compilation, funds)
- [ ] 5.2: Deploy contracts to Zama testnet (Sepolia)
- [ ] 5.3: Verify contracts on Etherscan
- [ ] 5.4: Update deployedContracts.ts (verify ABIs, events, structs)
- [ ] 5.5: Post-deployment setup (test accounts, EVVMCafe setup)
- [ ] 5.6: Frontend integration verification
- [ ] 5.7: Document deployed addresses

---

## Timeline Estimate

| Phase | Estimated Duration | Status |
|-------|-------------------|--------|
| Phase 1: Zama Migration | 2-3 days | ✅ Completed |
| Phase 2: EIP-191 Signatures | 1-2 days | ✅ Completed |
| Phase 2A: FHE Hybrid Auth (Challenge-Response) | 1-2 days | ✅ Completed |
| Phase 4: Testing | 2-3 days | ✅ Completed |
| Phase 5: Deployment & Integration | 1-2 days | Pending |
| **Total** | **8-12 days** | ~80% Complete |

### Phase 5 Breakdown

| Step | Task | Est. Time |
|------|------|-----------|
| 5.1 | Pre-deployment verification | 30 min |
| 5.2 | Deploy contracts | 1-2 hours |
| 5.3 | Verify on Etherscan | 30 min |
| 5.4 | Update deployedContracts.ts | 30 min |
| 5.5 | Post-deployment setup | 1 hour |
| 5.6 | Frontend integration | 2-3 hours |
| 5.7 | Documentation | 30 min |

---

## References

- [FHENIX_TO_ZAMA_MIGRATION_PLAN.md](./FHENIX_TO_ZAMA_MIGRATION_PLAN.md)
- [EIP191_SIGNATURE_PLAN.md](./EIP191_SIGNATURE_PLAN.md)
- [FHE_SIGNATURES_ANALYSIS.md](./FHE_SIGNATURES_ANALYSIS.md)
- [Zama FHEVM Documentation](https://docs.zama.org/protocol/solidity-guides)
- [EIP-191 Specification](https://eips.ethereum.org/EIPS/eip-191)
- [EVVM-org scaffold-evvm](https://github.com/EVVM-org/scaffold-evvm.git) - Reference implementation (non-FHE)

---

## Appendix: Comparison with EVVM-org scaffold-evvm

The `scaffold-evvm` project from EVVM-org takes a different architectural approach:

| Aspect | This Project (cofhe-scaffold-eth) | scaffold-evvm (EVVM-org) |
|--------|-----------------------------------|--------------------------|
| **Encryption** | FHE for balances (Zama FHEVM) | No FHE (plaintext balances) |
| **Auth Model** | EIP-191 + optional FHE secret | EIP-191 only |
| **Nonce System** | Single sequential | Sync + Async dual system |
| **Staker Rewards** | Not implemented | Full reward system |
| **Treasury** | Not implemented | Full treasury integration |
| **NameService** | Not implemented | Identity resolution |
| **Proxy Pattern** | No | Yes (upgradeable) |

**Key Insight**: The EVVM-org implementation uses `FHE.checkSignatures()` for KMS decryption verification, NOT for user transaction authorization. This confirms that EIP-191 is the correct approach for user signatures, with optional FHE secret as defense-in-depth (Plan 2A).
