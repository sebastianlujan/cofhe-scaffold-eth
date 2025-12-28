# EIP-191 Signature Validation Implementation Plan for EVVM

## Overview

This document outlines the implementation plan for adding EIP-191 (`personal_sign`) signature validation to the EVVMCore contract, replacing the current nonce-only replay protection with cryptographic authorization.

---

## 1. What is EIP-191?

EIP-191 defines a standard for signed data in Ethereum. The `personal_sign` method (version 0x45) prefixes the message with:

```
"\x19Ethereum Signed Message:\n" + len(message) + message
```

This prevents signed messages from being replayed as valid Ethereum transactions.

### Why EIP-191 over EIP-712?

| Feature | EIP-191 | EIP-712 |
|---------|---------|---------|
| Complexity | Simple | Complex (typed data) |
| Wallet Support | Universal | Most modern wallets |
| Human Readable | No (hex) | Yes (structured) |
| Use Case | Basic auth | Complex dApp interactions |

For EVVM's virtual transaction authorization, EIP-191 provides sufficient security with simpler implementation. EIP-712 can be added later for improved UX.

---

## 2. Implementation Components

### 2.1 Signature Struct

```solidity
/// @notice EIP-191 signature components
struct Signature {
    uint8 v;
    bytes32 r;
    bytes32 s;
}
```

### 2.2 Domain Constants

```solidity
/// @notice Domain identifier for EVVM signatures
bytes32 public constant EVVM_DOMAIN = keccak256("EVVM Virtual Transaction");

/// @notice Version for signature scheme (allows future upgrades)
uint8 public constant SIGNATURE_VERSION = 1;
```

---

## 3. Message Hash Construction

### 3.1 Transfer Message Hash

The message hash for a transfer includes all contextual data to prevent replay attacks:

```solidity
/// @notice Creates the message hash for a transfer operation
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

### 3.2 Why Each Field is Included

| Field | Purpose |
|-------|---------|
| `EVVM_DOMAIN` | Prevents cross-protocol replay |
| `SIGNATURE_VERSION` | Allows future signature upgrades |
| `fromVaddr` | Authorizes specific sender |
| `toVaddr` | Authorizes specific recipient |
| `amountCommitment` | Binds to specific encrypted amount |
| `nonce` | Sequential replay protection |
| `deadline` | Time-limited validity |
| `vChainId` | Prevents cross-vChain replay |
| `evvmID` | Prevents cross-EVVM replay |
| `block.chainid` | Prevents cross-L1-chain replay |
| `address(this)` | Prevents cross-contract replay |

---

## 4. EIP-191 Prefixed Hash

```solidity
/// @notice Applies EIP-191 prefix to message hash
/// @param messageHash The raw message hash
/// @return prefixedHash The EIP-191 prefixed hash ready for ecrecover
function toEthSignedMessageHash(bytes32 messageHash) internal pure returns (bytes32) {
    // EIP-191 version 0x45 (E): personal_sign
    // Format: "\x19Ethereum Signed Message:\n" + len + message
    // For bytes32, len = 32
    return keccak256(abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        messageHash
    ));
}
```

---

## 5. Signature Recovery

### 5.1 Basic Recovery Function

```solidity
/// @notice Recovers signer address from signature
/// @param messageHash The original message hash (before EIP-191 prefix)
/// @param sig The signature components (v, r, s)
/// @return signer The recovered address
function recoverSigner(
    bytes32 messageHash,
    Signature memory sig
) public pure returns (address) {
    bytes32 ethSignedHash = toEthSignedMessageHash(messageHash);
    
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

### 5.2 Using OpenZeppelin ECDSA (Recommended)

```solidity
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

using ECDSA for bytes32;
using MessageHashUtils for bytes32;

/// @notice Recovers signer using OpenZeppelin's secure implementation
/// @param messageHash The original message hash
/// @param signature The packed signature bytes (65 bytes: r + s + v)
/// @return signer The recovered address
function recoverSignerOZ(
    bytes32 messageHash,
    bytes memory signature
) public pure returns (address) {
    return messageHash.toEthSignedMessageHash().recover(signature);
}
```

---

## 6. Signed Transfer Function

### 6.1 New Function Signature

```solidity
/// @notice Applies a signed transfer within the virtual blockchain
/// @param fromVaddr Source virtual account
/// @param toVaddr Destination virtual account
/// @param amount Encrypted amount (externalEuint64 for Zama, InEuint64 for Fhenix)
/// @param inputProof ZK proof for encrypted input (Zama only)
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
    address recoveredSigner = recoverSigner(messageHash, sig);
    require(recoveredSigner == authorizedSigner, "EVVM: invalid signature");
    
    // 6. Process transfer (reuse existing logic)
    return _applyTransferInternal(fromVaddr, toVaddr, amount, inputProof, expectedNonce, true);
}
```

### 6.2 Batch Signed Transfers

```solidity
/// @notice Parameters for a batch signed transfer
struct SignedTransferParams {
    bytes32 fromVaddr;
    bytes32 toVaddr;
    externalEuint64 amount;
    bytes inputProof;
    uint64 expectedNonce;
    uint256 deadline;
    Signature sig;
}

/// @notice Processes multiple signed transfers in a single transaction
function applySignedTransferBatch(
    SignedTransferParams[] calldata transfers
) external returns (uint256 successfulTxs, uint256 failedTxs, uint256[] memory txIds) {
    // Implementation similar to existing applyTransferBatch
    // but with signature validation for each transfer
}
```

---

## 7. Security Considerations

### 7.1 Replay Attack Prevention

| Attack Vector | Mitigation |
|---------------|------------|
| Same chain replay | Nonce prevents reuse |
| Cross-chain replay | `block.chainid` in hash |
| Cross-vChain replay | `vChainId` in hash |
| Cross-EVVM replay | `evvmID` in hash |
| Cross-contract replay | `address(this)` in hash |
| Time-based attacks | Deadline expiration |

### 7.2 Signature Malleability

ECDSA signatures have malleability issues. Mitigations:

1. **Check `s` value** (EIP-2): Ensure `s` is in the lower half
2. **Use OpenZeppelin**: Their ECDSA library handles this
3. **Nonce tracking**: Even malleable signatures can't bypass nonce

### 7.3 Front-Running Protection

```solidity
// Include deadline to limit exposure window
require(block.timestamp <= deadline, "EVVM: signature expired");

// Recommended: Keep deadlines short (e.g., 5-10 minutes)
uint256 recommendedDeadline = block.timestamp + 5 minutes;
```

### 7.4 Amount Commitment

Since the amount is encrypted, we can't include the plaintext in the signature. Instead:

```solidity
// Create commitment to the ciphertext handle
bytes32 amountCommitment = keccak256(abi.encodePacked(amount));
```

This binds the signature to a specific encrypted value without revealing it.

---

## 8. Frontend Integration

### 8.1 Signature Generation (ethers.js v6)

```typescript
import { ethers } from "ethers";

async function signTransfer(
    signer: ethers.Signer,
    fromVaddr: string,
    toVaddr: string,
    encryptedAmount: string,  // The ciphertext handle
    nonce: bigint,
    deadline: bigint,
    contractAddress: string,
    vChainId: bigint,
    evvmID: bigint
): Promise<{ v: number; r: string; s: string }> {
    
    // 1. Create amount commitment
    const amountCommitment = ethers.keccak256(
        ethers.solidityPacked(["bytes32"], [encryptedAmount])
    );
    
    // 2. Create message hash (must match contract's getTransferMessageHash)
    const EVVM_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("EVVM Virtual Transaction"));
    const SIGNATURE_VERSION = 1;
    const chainId = await signer.provider!.getNetwork().then(n => n.chainId);
    
    const messageHash = ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "uint8", "bytes32", "bytes32", "bytes32", "uint64", "uint256", "uint64", "uint256", "uint256", "address"],
            [EVVM_DOMAIN, SIGNATURE_VERSION, fromVaddr, toVaddr, amountCommitment, nonce, deadline, vChainId, evvmID, chainId, contractAddress]
        )
    );
    
    // 3. Sign with EIP-191 personal_sign
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    
    // 4. Split signature
    const sig = ethers.Signature.from(signature);
    
    return {
        v: sig.v,
        r: sig.r,
        s: sig.s
    };
}
```

### 8.2 Complete Transfer Flow

```typescript
async function executeSignedTransfer(
    evvmCore: EVVMCore,
    signer: ethers.Signer,
    toAddress: string,
    amount: number
) {
    const signerAddress = await signer.getAddress();
    const fromVaddr = await evvmCore.getVaddrFromAddress(signerAddress);
    const toVaddr = await evvmCore.getVaddrFromAddress(toAddress);
    const nonce = await evvmCore.getNonce(fromVaddr);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes
    
    // 1. Create encrypted input (Zama pattern)
    const encryptedInput = await fhevm
        .createEncryptedInput(await evvmCore.getAddress(), signerAddress)
        .add64(amount)
        .encrypt();
    
    // 2. Sign the transfer
    const sig = await signTransfer(
        signer,
        fromVaddr,
        toVaddr,
        encryptedInput.handles[0],
        nonce,
        deadline,
        await evvmCore.getAddress(),
        await evvmCore.vChainId(),
        await evvmCore.evvmID()
    );
    
    // 3. Execute signed transfer
    const tx = await evvmCore.applySignedTransfer(
        fromVaddr,
        toVaddr,
        encryptedInput.handles[0],
        encryptedInput.inputProof,
        nonce,
        deadline,
        sig
    );
    
    return tx;
}
```

---

## 9. Implementation Checklist

### Phase 1: Core Implementation
- [ ] Add `Signature` struct to EVVMCore
- [ ] Add domain constants (`EVVM_DOMAIN`, `SIGNATURE_VERSION`)
- [ ] Implement `getTransferMessageHash()`
- [ ] Implement `toEthSignedMessageHash()`
- [ ] Implement `recoverSigner()` with malleability checks
- [ ] Add OpenZeppelin ECDSA import (optional but recommended)

### Phase 2: Function Updates
- [ ] Create `applySignedTransfer()` function
- [ ] Update `requestPay()` to optionally accept signatures
- [ ] Create `applySignedTransferBatch()` function

### Phase 3: Testing
- [ ] Unit test signature generation
- [ ] Unit test signature recovery
- [ ] Test replay attack prevention
- [ ] Test deadline expiration
- [ ] Test invalid signature rejection
- [ ] Integration test with frontend signing

### Phase 4: Frontend
- [ ] Create `signTransfer()` utility function
- [ ] Update transfer UI to include signing step
- [ ] Add deadline configuration
- [ ] Handle signature errors gracefully

---

## 10. Gas Considerations

| Operation | Approximate Gas |
|-----------|-----------------|
| `ecrecover` | ~3,000 |
| `keccak256` (message hash) | ~30-50 |
| Additional checks | ~500 |
| **Total overhead** | **~4,000 gas** |

The signature validation adds minimal overhead compared to the FHE operations which dominate gas costs.

---

## 11. Future Enhancements

### 11.1 EIP-712 Typed Data (Better UX)

```solidity
// Future: Add EIP-712 for human-readable signing
bytes32 public constant TRANSFER_TYPEHASH = keccak256(
    "Transfer(bytes32 from,bytes32 to,bytes32 amountCommitment,uint64 nonce,uint256 deadline)"
);
```

### 11.2 Multi-Signature Support

```solidity
// Future: Require multiple signatures for high-value transfers
function applyMultiSigTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature[] calldata signatures,
    uint8 requiredSignatures
) external returns (uint256 txId);
```

### 11.3 Delegated Signing

```solidity
// Future: Allow delegation of signing authority
mapping(bytes32 => mapping(address => bool)) public authorizedSigners;

function addAuthorizedSigner(bytes32 vaddr, address signer) external;
function removeAuthorizedSigner(bytes32 vaddr, address signer) external;
```

---

## Appendix A: Full Implementation Example

See the complete implementation in `contracts/core/EVVM.core.sol` after migration.

## Appendix B: Test Vectors

```javascript
// Test vector for signature verification
const testVector = {
    fromVaddr: "0x1234...5678",
    toVaddr: "0xabcd...ef01",
    amountCommitment: "0x9876...5432",
    nonce: 0n,
    deadline: 1735689600n,  // Jan 1, 2025
    vChainId: 1n,
    evvmID: 100n,
    chainId: 11155111n,     // Sepolia
    contractAddress: "0xContract...",
    
    // Expected message hash (before EIP-191 prefix)
    expectedMessageHash: "0x...",
    
    // Expected signature from test private key
    expectedSignature: {
        v: 27,
        r: "0x...",
        s: "0x..."
    }
};
```

---

## References

- [EIP-191: Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
- [EIP-712: Typed Structured Data Hashing and Signing](https://eips.ethereum.org/EIPS/eip-712)
- [OpenZeppelin ECDSA Library](https://docs.openzeppelin.com/contracts/4.x/api/utils#ECDSA)
- [Ethereum Signature Security](https://blog.openzeppelin.com/signing-and-validating-ethereum-signatures)
