# FHEVM Upgrade Analysis: v0.8.0 to v0.9.1

## Summary

This document provides a complete analysis of upgrading the EVVM contracts from `@fhevm/solidity@0.8.0` to `@fhevm/solidity@0.9.1` to fix the `InvalidSigner(address)` error occurring during encryption verification on Sepolia.

**Date:** December 27, 2025  
**Status:** Implementation in Progress

---

## 1. Root Cause Analysis

### 1.1 The Error

```
Error: 0xbf18af43 = InvalidSigner(address)
```

This error is thrown by Zama's `InputVerifier` contract at line 460:
```solidity
if (!isSigner(signerRecovered)) {
    revert InvalidSigner(signerRecovered);
}
```

The signature inside the encryption proof is recovered to an address that is **not** in the list of authorized coprocessor signers on the `InputVerifier` contract.

### 1.2 Version Mismatch

| Component | Current (Our Project) | Required (Reference) |
|-----------|----------------------|---------------------|
| `@fhevm/solidity` | `0.8.0` | `^0.9.1` |
| `@fhevm/hardhat-plugin` | `^0.1.0` | `^0.3.0-1` |
| `@fhevm/mock-utils` | `0.1.0` | `^0.3.0-1` |
| `@zama-fhe/relayer-sdk` | `^0.2.0` | `^0.3.0-5` |

### 1.3 Core Contract Address Mismatch

**Contracts deployed with `@fhevm/solidity@0.8.0` use:**
```json
{
  "ACLAddress": "0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D",
  "CoprocessorAddress": "0xCD3ab3bd6bcc0c0bf3E27912a92043e817B1cf69",
  "HCULimitAddress": "0x36772142b74871f255CbD7A3e89B401d3e45825f",
  "InputVerifierAddress": "0x901F8942346f7AB3a01F6D7613119Bca447Bb030"
}
```
(Source: `packages/hardhat/fhevmTemp/precompiled-fhevm-core-contracts-addresses.json`)

**Frontend SDK `0.3.0-5` (SepoliaConfig) uses:**
```
aclContractAddress: '0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D'
```

These are **completely different contracts** on Sepolia with different registered coprocessor signers.

---

## 2. Required Changes

### 2.1 Package.json Updates

**File:** `packages/hardhat/package.json`

```diff
{
  "dependencies": {
-   "@fhevm/hardhat-plugin": "^0.1.0",
-   "@fhevm/solidity": "0.8.0",
+   "@fhevm/hardhat-plugin": "^0.3.0-1",
+   "@fhevm/solidity": "^0.9.1",
  },
  "devDependencies": {
-   "@fhevm/mock-utils": "0.1.0",
-   "@zama-fhe/relayer-sdk": "^0.2.0",
+   "@fhevm/mock-utils": "^0.3.0-1",
+   "@zama-fhe/relayer-sdk": "^0.3.0-8",
  }
}
```

### 2.2 Contract Import Changes

**File:** `packages/hardhat/contracts/core/EVVM.core.sol`

```diff
- import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
+ import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

- contract EVVMCore is Ownable, SepoliaConfig {
+ contract EVVMCore is Ownable, ZamaEthereumConfig {
```

### 2.3 Solidity Version

**Current:** `0.8.24`  
**Reference uses:** `0.8.27`

The contracts should compile with both versions, but `0.8.27` is recommended for full compatibility.

---

## 3. Files Affected

### 3.1 Files to Modify

| File Path | Changes |
|-----------|---------|
| `packages/hardhat/package.json` | Update 4 FHEVM dependencies |
| `packages/hardhat/contracts/core/EVVM.core.sol` | Update import and inheritance |

### 3.2 Files Generated on Deploy

| File Path | Description |
|-----------|-------------|
| `packages/hardhat/deployments/sepolia/EVVMCore.json` | New deployment artifact |
| `packages/hardhat/deployments/sepolia/EVVMCafe.json` | New deployment artifact |
| `packages/nextjs/contracts/deployedContracts.ts` | Auto-generated ABIs |
| `packages/hardhat/fhevmTemp/` | New FHE core contract addresses |

---

## 4. Deployment Plan

### 4.1 Pre-deployment Steps

1. Backup old deployment files
2. Update package.json dependencies
3. Clean build artifacts and fhevmTemp
4. Update contract imports
5. Reinstall dependencies
6. Compile contracts
7. Run tests (optional but recommended)

### 4.2 Deployment Commands

```bash
# Backup old deployments
cp -r packages/hardhat/deployments/sepolia packages/hardhat/deployments/sepolia_backup_v0.8.0

# Clean
cd packages/hardhat
rm -rf fhevmTemp artifacts cache node_modules

# Install
npm install

# Compile
npm run compile

# Deploy
npm run deploy -- --network sepolia
```

### 4.3 Post-deployment Verification

1. Verify new contract addresses are different from old
2. Verify frontend SDK connects to same ACL address as contracts
3. Test `registerAccountFromAddress` works without `InvalidSigner` error
4. Test full encryption/decryption flow

---

## 5. Old vs New Deployed Contracts

### Old Contracts (v0.8.0 - Non-functional)

| Contract | Address |
|----------|---------|
| EVVMCore | `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50` |
| EVVMCafe | `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc` |

### New Contracts (v0.9.1 - TBD)

| Contract | Address |
|----------|---------|
| EVVMCore | *To be deployed* |
| EVVMCafe | *To be deployed* |

---

## 6. Reference Implementation

The working reference implementation is in `packages/dapps/packages/hardhat/`:

```typescript
// hardhat.config.ts
solidity: {
  version: "0.8.27",
  settings: {
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 800 }
  }
}
```

```solidity
// Example contract
import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHECounter is ZamaEthereumConfig {
    // Uses new config that matches SDK's SepoliaConfig
}
```

---

## 7. Risk Assessment

| Risk Level | Description | Mitigation |
|------------|-------------|------------|
| Low | Contract logic unchanged | N/A |
| Low | Only config inheritance changes | Test before deploy |
| Medium | Existing state lost (new addresses) | Document old addresses |
| Medium | Tests may need updates | Run tests first |

---

## 8. Verification Checklist

After deployment:

- [ ] New EVVMCore address is different from `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50`
- [ ] New EVVMCafe address is different from `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc`
- [ ] Frontend shows correct ACL address in console logs
- [ ] `registerAccountFromAddress` works without `InvalidSigner` error
- [ ] Encryption works (handle + proof generated)
- [ ] Decryption works (value retrieved)

---

## 9. Rollback Plan

If deployment fails or new contracts don't work:

1. Contracts are on a new address, old ones unaffected
2. Revert `deployedContracts.ts` to use old addresses
3. Investigate issue before retry

---

## Appendix A: Error Signature Lookup

```
0xbf18af43 = keccak256("InvalidSigner(address)")[:4]
```

Confirmed by:
```javascript
const { keccak256, toBytes } = require('viem');
keccak256(toBytes('InvalidSigner(address)')).slice(0, 10);
// Returns: '0xbf18af43'
```

---

## Appendix B: SDK CDN URL

The frontend uses:
```
https://cdn.zama.org/relayer-sdk-js/0.3.0-5/relayer-sdk-js.umd.cjs
```

This SDK version's `SepoliaConfig` uses the **new** core contract addresses, which is why the upgrade is required.
