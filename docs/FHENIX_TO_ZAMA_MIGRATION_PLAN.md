# EVVMCore Fhenix to Zama FHEVM Porting Plan

## Executive Summary

This document outlines the migration plan for porting the EVVM (Encrypted Virtual VM) Core contract from **Fhenix CoFHE** to **Zama FHEVM**. The migration involves:

1. **Import changes** - Replacing Fhenix imports with Zama FHEVM imports
2. **Type mappings** - Converting encrypted input types from Fhenix to Zama equivalents
3. **Operation adaptations** - Updating FHE function calls to match Zama's API
4. **ACL/Permission changes** - Migrating permission system from Fhenix to Zama's ACL
5. **Configuration inheritance** - Adding Zama network configuration

---

## Part 1: Import Mapping (Fhenix → Zama)

### Current Fhenix Imports
```solidity
// EVVM.core.sol (current)
import "@fhenixprotocol/cofhe-contracts/FHE.sol";

// FHECounter.sol (current)  
import "@fhenixprotocol/cofhe-contracts/FHE.sol";
```

### Target Zama Imports
```solidity
// EVVM.core.sol (target)
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
```

### Package Dependencies
| Fhenix Package | Zama Equivalent |
|----------------|-----------------|
| `@fhenixprotocol/cofhe-contracts` | `@fhevm/solidity` |
| N/A (no hardhat plugin) | `@fhevm/hardhat-plugin` |

---

## Part 2: Type Mapping (Fhenix → Zama)

### Encrypted Types

| Fhenix Type | Zama Type | Description |
|-------------|-----------|-------------|
| `euint32` | `euint32` | Same |
| `euint64` | `euint64` | Same |
| `euint128` | `euint128` | Same |
| `ebool` | `ebool` | Same |

### External Input Types (Critical Difference!)

| Fhenix Type | Zama Type | Notes |
|-------------|-----------|-------|
| `InEuint32` | `externalEuint32` | Fhenix uses `InEuintXX`, Zama uses `externalEuintXX` |
| `InEuint64` | `externalEuint64` | Fhenix uses `InEuintXX`, Zama uses `externalEuintXX` |
| N/A | `bytes calldata inputProof` | **Zama requires separate proof parameter** |

### Conversion Pattern

**Fhenix (current):**
```solidity
function registerAccount(bytes32 vaddr, InEuint64 calldata initialBalance) external {
    euint64 balance = FHE.asEuint64(initialBalance);
    // ...
}
```

**Zama (target):**
```solidity
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

## Part 3: FHE Operation Mapping

### Arithmetic Operations (Compatible)

| Operation | Fhenix | Zama | Status |
|-----------|--------|------|--------|
| Addition | `FHE.add(a, b)` | `FHE.add(a, b)` | Same |
| Subtraction | `FHE.sub(a, b)` | `FHE.sub(a, b)` | Same |
| Scalar Add | `FHE.add(a, 1)` | `FHE.add(a, 1)` | Same |

### Input Conversion (Breaking Change!)

| Fhenix | Zama | Notes |
|--------|------|-------|
| `FHE.asEuint64(InEuint64 val)` | `FHE.fromExternal(externalEuint64 val, bytes proof)` | **Different signature** |
| `FHE.asEuint32(InEuint32 val)` | `FHE.fromExternal(externalEuint32 val, bytes proof)` | **Different signature** |

### Literal Encryption (Compatible)

| Operation | Fhenix | Zama | Status |
|-----------|--------|------|--------|
| Trivial encrypt | `FHE.asEuint64(0)` | `FHE.asEuint64(0)` | Same |

---

## Part 4: Access Control / Permissions Mapping

### Permission Functions

| Fhenix | Zama | Description |
|--------|------|-------------|
| `FHE.allowThis(handle)` | `FHE.allowThis(handle)` | Allow current contract |
| `FHE.allowSender(handle)` | `FHE.allow(handle, msg.sender)` | **Different syntax** |
| `FHE.allowGlobal(handle)` | `FHE.makePubliclyDecryptable(handle)` | **Different name** |
| N/A | `FHE.allow(handle, address)` | Allow specific address |
| N/A | `FHE.allowTransient(handle, address)` | Transient (tx-only) permission |

### Permission Strategy Changes

**Fhenix (current):**
```solidity
// Global access for decryption
FHE.allowGlobal(balance);
FHE.allowThis(balance);
FHE.allowSender(balance);
```

**Zama (target):**
```solidity
// Explicit ACL permissions
FHE.allowThis(balance);                    // Contract can use
FHE.allow(balance, msg.sender);            // Sender can decrypt
FHE.makePubliclyDecryptable(balance);      // Anyone can decrypt (if needed)
```

### Key Differences:
1. Zama requires **explicit permission grants** to each address
2. `allowGlobal` → `makePubliclyDecryptable` (only for public reveal)
3. Zama has `allowTransient` for gas-efficient temporary permissions

---

## Part 5: Contract Configuration

### Current Fhenix Pattern
```solidity
// No special inheritance required
contract EVVMCore is Ownable {
    // ...
}
```

### Target Zama Pattern
```solidity
// MUST inherit ZamaEthereumConfig for network setup
contract EVVMCore is Ownable, ZamaEthereumConfig {
    constructor(uint64 _vChainId, uint256 _evvmID) Ownable(msg.sender) {
        // ZamaEthereumConfig constructor auto-configures FHE coprocessor
        // ...
    }
}
```

---

## Part 6: Function-by-Function Migration Checklist

### EVVMCore.sol Functions

| Function | Changes Required |
|----------|------------------|
| `registerAccount` | `InEuint64` → `externalEuint64` + `bytes inputProof`; `asEuint64` → `fromExternal` |
| `applyTransfer` | Same as above |
| `_applyTransferInternal` | Same as above |
| `faucetAddBalance` | Same as above |
| `registerAccountFromAddress` | Same as above |
| `requestPay` | Same as above; fix permission calls |
| `_applyTransferWithConvertedAmount` | Internal; update ACL calls |
| Permission calls | `allowSender` → `allow(, msg.sender)`; `allowGlobal` → review usage |

### EVVMCafe.sol Functions

| Function | Changes Required |
|----------|------------------|
| `withdrawFunds` | `InEuint64` → `externalEuint64` + proof |
| `registerShopInEVVM` | Same as above |

---

## Part 7: Test Migration Plan

### Hardhat Plugin Changes

**Fhenix (current):**
```typescript
// No specific FHE plugin
import { ethers } from "hardhat";
```

**Zama (target):**
```typescript
import { ethers, fhevm } from "hardhat";  // fhevm from @fhevm/hardhat-plugin
```

### Encryption Input Changes

**Fhenix (current pattern - if exists):**
```typescript
// Direct value passing (CoFHE SDK handles encryption)
const encryptedValue = await cofheClient.encrypt(100);
await contract.registerAccount(vaddr, encryptedValue);
```

**Zama (target):**
```typescript
// Create encrypted input with contract and user context
const encryptedInput = await fhevm
    .createEncryptedInput(contractAddress, userAddress)
    .add64(100)  // For euint64
    .encrypt();

await contract.registerAccount(
    vaddr,
    encryptedInput.handles[0],     // externalEuint64
    encryptedInput.inputProof      // bytes proof
);
```

### Decryption Changes

**Zama decryption:**
```typescript
import { FhevmType } from "@fhevm/hardhat-plugin";

const encryptedBalance = await contract.getEncryptedBalance(vaddr);
const clearBalance = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    encryptedBalance,
    contractAddress,
    signer
);
```

---

## Part 8: Migration Steps (Ordered)

### Phase 1: Dependencies & Setup
- [ ] Update `package.json` with Zama packages
- [ ] Install `@fhevm/solidity` and `@fhevm/hardhat-plugin`
- [ ] Update `hardhat.config.ts` for Zama plugin
- [ ] Configure network settings for Zama testnet (Sepolia)

### Phase 2: Contract Migration
- [ ] Create new branch `feature/zama-migration`
- [ ] Update imports in all contracts
- [ ] Add `ZamaEthereumConfig` inheritance to `EVVMCore` and `EVVMCafe`
- [ ] Migrate all `InEuintXX` types to `externalEuintXX` + `inputProof`
- [ ] Update `FHE.asEuintXX(input)` → `FHE.fromExternal(input, proof)`
- [ ] Update ACL calls (`allowSender` → `allow`, etc.)
- [ ] Review all `allowGlobal` usages for Zama compatibility

### Phase 3: Test Migration
- [ ] Update test imports for `fhevm` plugin
- [ ] Convert encryption helpers to Zama pattern
- [ ] Update decryption calls
- [ ] Verify ACL permissions in tests

### Phase 4: Frontend Updates
- [ ] Update SDK from Fhenix to Zama (`fhevmjs`)
- [ ] Update encryption flow for user inputs
- [ ] Update decryption flow

---

## Part 9: Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ACL behavior differences | High | Thorough testing of all permission scenarios |
| Gas cost differences | Medium | Benchmark critical operations |
| Network availability | High | Use Zama testnet (Sepolia) for development |
| Breaking API changes | High | Pin to specific `@fhevm/solidity` version |

---

## Appendix A: Quick Reference Card

### Import Statement
```solidity
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
```

### Input Pattern
```solidity
function myFunction(externalEuint64 value, bytes calldata inputProof) external {
    euint64 encValue = FHE.fromExternal(value, inputProof);
    FHE.allowThis(encValue);
    FHE.allow(encValue, msg.sender);
}
```

---

## Appendix B: Files to Modify

| File | Changes |
|------|---------|
| `packages/hardhat/contracts/core/EVVM.core.sol` | Full migration |
| `packages/hardhat/contracts/examples/EVVMCafe.sol` | Input type migration |
| `packages/hardhat/contracts/FHECounter.sol` | Simple migration example |
| `packages/hardhat/test/EVVMCore.test.ts` | Test migration |
| `packages/hardhat/test/EVVMCafe.integration.test.ts` | Test migration |
| `packages/hardhat/hardhat.config.ts` | Plugin setup |
| `packages/hardhat/package.json` | Dependencies |
| `packages/nextjs/app/useCofhe.ts` | Frontend SDK migration |
| `packages/nextjs/app/useEncryptInput.ts` | Encryption migration |

---

## Appendix C: Reference Documentation

- [Zama FHEVM Solidity Guides](https://docs.zama.org/protocol/solidity-guides)
- [Zama FHE Operations](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations)
- [Zama Encrypted Inputs](https://docs.zama.org/protocol/solidity-guides/smart-contract/inputs)
- [Zama Access Control List](https://docs.zama.org/protocol/solidity-guides/smart-contract/acl)
- [Zama Configuration](https://docs.zama.org/protocol/solidity-guides/smart-contract/configure)
- [Zama Examples](https://docs.zama.org/protocol/examples)
