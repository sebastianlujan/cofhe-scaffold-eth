# FHE Signatures in EVVM: Feasibility Analysis

## Executive Summary

This document analyzes the feasibility of implementing cryptographic signatures using Fully Homomorphic Encryption (FHE) within the EVVMCore contract, as an alternative or complement to traditional EIP-191 signatures.

**Conclusion**: Pure FHE signatures are **not currently practical** due to fundamental limitations in FHE operations. However, **hybrid approaches** combining plaintext signatures with FHE-based authorization are viable and can provide enhanced security.

---

## 1. The Core Question

> Can we implement signature verification entirely within FHE, keeping the authorization process fully encrypted?

---

## 2. Why Pure FHE Signatures Are Not Possible

### 2.1 The Fundamental Issue: Verification Requires Decryption

Traditional ECDSA signature verification uses the `ecrecover` precompile:

```solidity
// Standard signature verification
address recoveredSigner = ecrecover(hash, v, r, s);
require(recoveredSigner == authorizedAddress, "Invalid signature");
```

With FHE, we would want:

```solidity
// This is NOT possible:
address recoveredSigner = ecrecover(hash, v, r, s);
ebool isValid = FHE.eq(encryptedAuthorizedSigner, recoveredSigner); // ❌ Cannot mix types
```

**Problem**: `ecrecover` is a precompile that operates on plaintext data and returns a plaintext address. You cannot:
- Feed encrypted data into `ecrecover`
- Compare the plaintext result with an encrypted value directly

### 2.2 ECDSA Operations Not Supported in FHE

Current FHE libraries (Fhenix CoFHE, Zama FHEVM) support limited operations:

| Category | Supported Operations |
|----------|---------------------|
| Arithmetic | `add`, `sub`, `mul`, `div`, `rem`, `neg`, `min`, `max` |
| Comparison | `eq`, `ne`, `gt`, `lt`, `ge`, `le` |
| Bitwise | `and`, `or`, `xor`, `not`, `shl`, `shr`, `rotl`, `rotr` |
| Selection | `select` (ternary) |
| Random | `randEuintX` |

**NOT Supported** (required for cryptographic signatures):

| Operation | Why It's Needed | Status |
|-----------|-----------------|--------|
| Modular exponentiation | RSA signatures | Not available |
| Elliptic curve point multiplication | ECDSA signatures | Not available |
| Elliptic curve point addition | ECDSA signatures | Not available |
| Modular inverse | ECDSA verification | Not available |
| Keccak256 on encrypted data | Message hashing | Not available |

### 2.3 The Mathematical Gap

ECDSA signature verification requires:

```
1. Compute: u1 = hash * s^(-1) mod n
2. Compute: u2 = r * s^(-1) mod n  
3. Compute: R = u1*G + u2*PublicKey  (elliptic curve operations)
4. Verify: R.x mod n == r
```

None of these operations are available in current FHE implementations. Implementing them would require:
- Massive circuit depth (prohibitive gas costs)
- Custom FHE operations not yet developed
- Potentially years of research

---

## 3. What IS Possible: Hybrid Approaches

While pure FHE signatures are not feasible, several hybrid approaches can enhance security:

### 3.1 Approach 1: Encrypted Authorization Tokens

Use encrypted "tokens" that prove knowledge of a secret without revealing it:

```solidity
/// @notice Encrypted authorization commitment per account
mapping(bytes32 => euint64) private authCommitments;

/// @notice Set during account registration (only owner knows plaintext)
function setAuthCommitment(
    bytes32 vaddr,
    externalEuint64 commitment,
    bytes calldata inputProof
) external {
    // Only callable by account owner
    require(vaddrToAddress[vaddr] == msg.sender, "Not authorized");
    authCommitments[vaddr] = FHE.fromExternal(commitment, inputProof);
    FHE.allowThis(authCommitments[vaddr]);
}

/// @notice Verify authorization using FHE comparison
/// @dev User must provide the same value they committed to
function verifyAuth(
    bytes32 vaddr,
    euint64 providedSecret
) internal returns (ebool) {
    return FHE.eq(providedSecret, authCommitments[vaddr]);
}
```

**Pros**:
- Secret never revealed on-chain
- Simple FHE operations only

**Cons**:
- Vulnerable to replay if not combined with nonces
- Commitment must be set up in advance

### 3.2 Approach 2: Challenge-Response with FHE

```solidity
/// @notice Active challenges per account
mapping(bytes32 => euint64) private activeChallenges;
mapping(bytes32 => euint64) private accountSecrets;

/// @notice Generate a random challenge for an account
function generateChallenge(bytes32 vaddr) external returns (euint64) {
    euint64 challenge = FHE.randEuint64();
    activeChallenges[vaddr] = challenge;
    FHE.allowThis(challenge);
    FHE.allow(challenge, vaddrToAddress[vaddr]);
    return challenge;
}

/// @notice Verify response: secret XOR challenge should match expected
function verifyResponse(
    bytes32 vaddr,
    externalEuint64 response,
    bytes calldata inputProof
) internal returns (ebool) {
    euint64 resp = FHE.fromExternal(response, inputProof);
    euint64 expected = FHE.xor(accountSecrets[vaddr], activeChallenges[vaddr]);
    return FHE.eq(resp, expected);
}
```

**Pros**:
- Fresh challenge prevents replay
- Secret remains encrypted

**Cons**:
- Requires two transactions (get challenge, submit response)
- Added complexity

### 3.3 Approach 3: EIP-191 + Encrypted Secret (Recommended Hybrid)

Combine plaintext signature with FHE secret verification:

```solidity
/// @notice Each account has an encrypted secret
mapping(bytes32 => euint64) private accountSecrets;

/// @notice Transfer requires BOTH:
/// 1. Valid EIP-191 signature (proves Ethereum address ownership)
/// 2. Correct encrypted secret (proves EVVM account ownership)
function applyDoubleAuthTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata inputProof,
    uint64 expectedNonce,
    uint256 deadline,
    Signature calldata sig,
    externalEuint64 secretProof,
    bytes calldata secretInputProof
) external returns (uint256 txId) {
    // LAYER 1: Verify EIP-191 signature (plaintext)
    address authorizedSigner = vaddrToAddress[fromVaddr];
    bytes32 messageHash = getTransferMessageHash(
        fromVaddr, toVaddr, keccak256(abi.encodePacked(amount)), 
        expectedNonce, deadline
    );
    require(recoverSigner(messageHash, sig) == authorizedSigner, "EVVM: invalid signature");
    
    // LAYER 2: Verify encrypted secret (FHE)
    euint64 providedSecret = FHE.fromExternal(secretProof, secretInputProof);
    ebool secretValid = FHE.eq(providedSecret, accountSecrets[fromVaddr]);
    
    // LAYER 3: Conditional amount (zero if secret invalid)
    euint64 transferAmount = FHE.fromExternal(amount, inputProof);
    euint64 effectiveAmount = FHE.select(secretValid, transferAmount, FHE.asEuint64(0));
    
    // Execute transfer with effective amount
    return _executeTransfer(fromVaddr, toVaddr, effectiveAmount, expectedNonce);
}
```

**Security Model**:

| Scenario | EIP-191 Only | Hybrid (EIP-191 + FHE Secret) |
|----------|--------------|-------------------------------|
| Signing key compromised | Account drained | Protected (need secret too) |
| Secret leaked | N/A | Protected (need signature too) |
| Both compromised | Account drained | Account drained |
| Replay attack | Blocked by nonce | Blocked by nonce |

---

## 4. The Conditional Execution Challenge

### 4.1 The Problem

FHE returns encrypted booleans (`ebool`). You cannot branch on encrypted values:

```solidity
ebool isAuthorized = FHE.eq(providedSecret, storedSecret);

// ❌ IMPOSSIBLE: Cannot branch on encrypted boolean
if (isAuthorized) {
    executeTransfer();
}

// ❌ IMPOSSIBLE: Cannot convert ebool to bool without decryption
bool authorized = FHE.decrypt(isAuthorized); // Requires oracle, async
```

### 4.2 The Solution: FHE.select

Instead of branching, use `FHE.select` to conditionally modify values:

```solidity
ebool isAuthorized = FHE.eq(providedSecret, storedSecret);

// ✅ POSSIBLE: Select between two encrypted values
euint64 effectiveAmount = FHE.select(
    isAuthorized,
    requestedAmount,      // If authorized: use requested amount
    FHE.asEuint64(0)      // If not authorized: use zero
);

// Transfer always executes, but with zero effect if unauthorized
_executeTransfer(from, to, effectiveAmount, nonce);
```

### 4.3 Implications of FHE.select Approach

| Aspect | Implication |
|--------|-------------|
| Gas consumption | Always consumed (even for invalid auth) |
| Events | Always emitted (with encrypted amounts) |
| Nonce | Always incremented (could be problematic) |
| Balance change | Zero if unauthorized (no actual theft) |
| Privacy | Attacker cannot tell if auth succeeded |

### 4.4 Handling Nonce Increment

The nonce increment issue requires careful handling:

```solidity
// Option A: Separate nonce validation (before FHE check)
require(fromAcc.nonce == expectedNonce, "EVVM: bad nonce");
// Then FHE check only affects amount, not nonce
fromAcc.nonce += 1; // Always increment

// Option B: Encrypted nonce increment (complex)
euint64 nonceIncrement = FHE.select(isAuthorized, FHE.asEuint64(1), FHE.asEuint64(0));
// But nonces are public in current design...

// Option C: Pre-validate signature, only use FHE for additional security
// Recommended: If signature fails, revert. FHE secret is bonus protection.
```

---

## 5. Recommended Architecture

Based on the analysis, here is the recommended hybrid architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                   HYBRID AUTH ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: EIP-191 Signature (Plaintext) [REQUIRED]             │
│  ├── Proves ownership of Ethereum address                       │
│  ├── Links to vaddr via vaddrToAddress mapping                  │
│  ├── Prevents unauthorized transaction submission               │
│  ├── Standard, well-audited cryptographic approach              │
│  └── Reverts immediately if invalid (saves gas)                 │
│                                                                 │
│  LAYER 2: Encrypted Amounts (FHE) [EXISTING]                    │
│  ├── Transfer amount remains confidential                       │
│  ├── Balance updates are encrypted                              │
│  ├── No observer learns how much was transferred                │
│  └── Core privacy feature of EVVM                               │
│                                                                 │
│  LAYER 3: Encrypted Account Secret (FHE) [OPTIONAL]             │
│  ├── Additional FHE-based authorization layer                   │
│  ├── Protects against compromised signing key alone             │
│  ├── Uses FHE.select for conditional effective amount           │
│  ├── Invalid secret = zero transfer (funds safe)                │
│  └── Defense in depth strategy                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 Security Analysis

| Threat | Layer 1 (Signature) | Layer 2 (Encrypted Amt) | Layer 3 (FHE Secret) |
|--------|---------------------|-------------------------|----------------------|
| Unauthorized submission | Blocks | N/A | Blocks (zero amount) |
| Amount observation | N/A | Protects | N/A |
| Signing key theft | Vulnerable | N/A | Protects |
| FHE secret theft | N/A | N/A | Vulnerable (but need sig too) |
| Replay attack | Blocks (nonce) | N/A | N/A |

### 5.2 Implementation Priority

1. **Phase 1**: Implement EIP-191 signatures (as per `EIP191_SIGNATURE_PLAN.md`)
2. **Phase 2**: Add optional FHE secret layer for high-security accounts
3. **Phase 3**: Research advanced FHE auth schemes as technology evolves

---

## 6. Future Possibilities

### 6.1 ZK-FHE Hybrid

Combine Zero-Knowledge Proofs with FHE:

```
User generates ZK proof: "I know secret S such that hash(S) = commitment"
Contract verifies ZK proof (plaintext verification)
FHE operations proceed with encrypted amounts
```

**Status**: Research phase, not production-ready

### 6.2 FHE-Friendly Signature Schemes

Some signature schemes might be more FHE-compatible:

| Scheme | FHE Compatibility | Notes |
|--------|-------------------|-------|
| ECDSA | Very Low | Requires EC operations |
| RSA | Low | Requires modular exponentiation |
| Lattice-based | Medium | Might be more compatible with FHE |
| Hash-based (SPHINCS+) | Low | Requires many hash operations |

**Status**: Active research area, years from production

### 6.3 Threshold FHE

Multiple parties hold key shares, requiring cooperation to decrypt:

```
Party A: holds share_a
Party B: holds share_b
Party C: holds share_c

Decryption requires: combine(share_a, share_b, share_c)
```

Could enable distributed authorization without full decryption.

**Status**: Theoretical, not implemented in current FHE libraries

---

## 7. Code Examples

### 7.1 Setting Up FHE Account Secret

```solidity
/// @notice Set encrypted secret during account registration
function registerAccountWithSecret(
    bytes32 vaddr,
    externalEuint64 initialBalance,
    bytes calldata balanceProof,
    externalEuint64 accountSecret,
    bytes calldata secretProof
) external {
    require(!accounts[vaddr].exists, "EVVM: account already exists");
    
    // Set up balance
    euint64 balance = FHE.fromExternal(initialBalance, balanceProof);
    accounts[vaddr].balance = balance;
    accounts[vaddr].nonce = 0;
    accounts[vaddr].exists = true;
    
    // Set up secret
    euint64 secret = FHE.fromExternal(accountSecret, secretProof);
    accountSecrets[vaddr] = secret;
    
    // Permissions
    FHE.allowThis(balance);
    FHE.allowThis(secret);
    FHE.allow(balance, msg.sender);
    // Note: Do NOT allow anyone to read the secret
    
    emit VirtualAccountRegistered(vaddr, 0);
}
```

### 7.2 Verifying FHE Secret in Transfer

```solidity
/// @notice Transfer with FHE secret verification
function applySecureTransfer(
    bytes32 fromVaddr,
    bytes32 toVaddr,
    externalEuint64 amount,
    bytes calldata amountProof,
    externalEuint64 secret,
    bytes calldata secretProof,
    uint64 expectedNonce
) external returns (uint256 txId) {
    require(accounts[fromVaddr].exists, "EVVM: from account missing");
    require(accounts[toVaddr].exists, "EVVM: to account missing");
    require(accounts[fromVaddr].nonce == expectedNonce, "EVVM: bad nonce");
    
    // Convert inputs
    euint64 transferAmount = FHE.fromExternal(amount, amountProof);
    euint64 providedSecret = FHE.fromExternal(secret, secretProof);
    
    // Verify secret
    ebool secretValid = FHE.eq(providedSecret, accountSecrets[fromVaddr]);
    
    // Conditional amount: zero if secret invalid
    euint64 effectiveAmount = FHE.select(
        secretValid,
        transferAmount,
        FHE.asEuint64(0)
    );
    
    // Execute transfer
    VirtualAccount storage fromAcc = accounts[fromVaddr];
    VirtualAccount storage toAcc = accounts[toVaddr];
    
    fromAcc.balance = FHE.sub(fromAcc.balance, effectiveAmount);
    toAcc.balance = FHE.add(toAcc.balance, effectiveAmount);
    fromAcc.nonce += 1;
    
    // ... rest of transfer logic
}
```

### 7.3 Frontend: Encrypting Secret

```typescript
async function encryptSecret(
    fhevm: any,
    contractAddress: string,
    userAddress: string,
    secretValue: bigint
): Promise<{ handle: string; proof: string }> {
    const encryptedInput = await fhevm
        .createEncryptedInput(contractAddress, userAddress)
        .add64(secretValue)
        .encrypt();
    
    return {
        handle: encryptedInput.handles[0],
        proof: encryptedInput.inputProof
    };
}
```

---

## 8. Conclusion

| Approach | Feasibility | Security | Complexity | Recommendation |
|----------|-------------|----------|------------|----------------|
| Pure FHE signatures | Not possible | N/A | N/A | Not recommended |
| EIP-191 only | Fully possible | Good | Low | **Implement first** |
| EIP-191 + FHE secret | Possible | Better | Medium | **Implement second** |
| Challenge-response FHE | Possible | Good | High | Consider for v2 |
| ZK-FHE hybrid | Future research | Excellent | Very High | Monitor progress |

**Final Recommendation**: Implement EIP-191 signatures as the primary authorization mechanism, with an optional FHE secret layer for accounts requiring additional security. This provides defense in depth while remaining practical with current FHE capabilities.

---

## References

- [Zama FHEVM Operations](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations)
- [EIP-191 Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
- [ECDSA Mathematics](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm)
- [FHE Limitations - Zama Blog](https://www.zama.ai/blog)
