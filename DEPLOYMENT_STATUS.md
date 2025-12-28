# EVVM Deployment Status

## Overview

This document tracks the deployment status of EVVM (Encrypted Virtual Value Machine) contracts across different networks.

## Deployed Contracts

### Sepolia Testnet (Zama FHEVM - Real Encryption)

| Contract | Address | Verified | Tx Hash |
|----------|---------|----------|---------|
| **EVVMCore** | `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50` | Yes | [0x8af26060...](https://sepolia.etherscan.io/tx/0x8af26060dde98d541c8e4536f577eb4b0ed6e8eff32dc44549704e429452bf05) |
| **EVVMCafe** | `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc` | Yes | [0x3cf75d6b...](https://sepolia.etherscan.io/tx/0x3cf75d6bc6d9e9f0c047052eaa8893f343f10ffd77e8c5f31e2184416771de64) |

**Etherscan Links:**
- EVVMCore: https://sepolia.etherscan.io/address/0xD645DD0cCf4eA74547d3304BC01dd550F3548A50#code
- EVVMCafe: https://sepolia.etherscan.io/address/0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc#code

**Contract Configuration:**
```
vChainId: 1
evvmID: 100
Owner: 0x899b5BdA341044a476350CE30986D31174bc42a1
```

**Deployment Date:** December 27, 2025

### Localhost (Hardhat Node - Mock Encryption)

| Contract | Address | Notes |
|----------|---------|-------|
| EVVMCore | `0x4bf010f1b9beDA5450a8dD702ED602A104ff65EE` | Local testing only |
| EVVMCafe | `0x40a42Baf86Fc821f972Ad2aC878729063CeEF403` | Local testing only |
| Multicall3 | `0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3` | Local testing only |

*Note: Localhost addresses change on each deployment.*

## Contract Architecture

```
contracts/
├── core/
│   └── EVVM.core.sol           # Main contract (4.89M gas)
├── interfaces/
│   ├── IEVVMCore.sol           # Core interface
│   ├── IEVVMSignedTransfers.sol    # Signed transfers
│   └── IEVVMSecureTransfers.sol    # Plan 2A secure transfers
├── periphery/
│   └── EVVMSignatureVerifier.sol   # Signature library
└── examples/
    └── EVVMCafe.sol            # Coffee shop demo (1.53M gas)
```

## Constructor Arguments

### EVVMCore
```solidity
constructor(uint64 _vChainId, uint256 _evvmID)
```
- `_vChainId`: 1 (Virtual chain ID)
- `_evvmID`: 100 (EVVM instance ID)

### EVVMCafe
```solidity
constructor(address _evvmCore, address _shopOwner)
```
- `_evvmCore`: Address of EVVMCore contract
- `_shopOwner`: Address of shop owner (deployer)

## Verification Commands

```bash
# Verify EVVMCore
npx hardhat verify --network sepolia 0xD645DD0cCf4eA74547d3304BC01dd550F3548A50 1 100

# Verify EVVMCafe
npx hardhat verify --network sepolia 0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc 0xD645DD0cCf4eA74547d3304BC01dd550F3548A50 0x899b5BdA341044a476350CE30986D31174bc42a1
```

## Test Status

### Local Tests (Mock FHE)
```
51 passing
0 pending
```

### Sepolia Tests (Real FHE)
Tests require Zama FHEVM relayer to be available. When running on Sepolia:
```bash
npx hardhat test test/e2e/EVVMCore.sepolia.test.ts --network sepolia
```

## Key Features

### Privacy Features
- **Encrypted Balances**: All account balances stored as `euint64`
- **Encrypted Transfers**: Transfer amounts are encrypted
- **Pseudonymous Addresses**: Virtual addresses (vaddr) for privacy

### Security Features
- **EIP-191 Signatures**: Cryptographic authorization
- **Plan 2A Authentication**: Two-phase challenge-response with FHE secrets
- **Nonce Protection**: Replay attack prevention
- **Deadline Expiry**: Time-limited signatures

### Transaction Types
1. **Basic Transfer**: Direct transfer with encrypted amount
2. **Signed Transfer**: Third-party submittable with signature
3. **Secure Transfer (Plan 2A)**: Two-phase with FHE secret verification
4. **Batch Transfer**: Multiple transfers in one transaction
5. **Address-based (requestPay)**: Uses Ethereum addresses instead of vaddr

## Gas Costs (Sepolia)

| Operation | Gas Used | Approx. Cost (@ 10 gwei) |
|-----------|----------|--------------------------|
| EVVMCore Deploy | 4,892,159 | ~0.049 ETH |
| EVVMCafe Deploy | 1,530,563 | ~0.015 ETH |
| Register Account | TBD | TBD |
| Transfer | TBD | TBD |

## Environment Setup

### Required Environment Variables
```bash
# .env file
DEPLOYER_PRIVATE_KEY=0x...        # Deployer account private key
ALCHEMY_API_KEY=oKxs-03sij-U_N0iOlrSsZFr29-IqbuF  # Or your own key
ETHERSCAN_MAINNET_API_KEY=...     # For contract verification
```

### Deployment Commands
```bash
# Local deployment
yarn chain  # Terminal 1
npx hardhat deploy --network localhost  # Terminal 2

# Sepolia deployment
npx hardhat deploy --network sepolia
```

## Future Deployments

### Planned Networks
- [ ] Ethereum Mainnet (pending audit)
- [ ] Arbitrum Sepolia (L2 testing)
- [ ] Base Sepolia (L2 testing)

## Changelog

### v1.0.0 (December 27, 2025)
- Initial Sepolia deployment
- EVVMCore with Plan 2A authentication
- EVVMCafe example contract
- Full contract verification on Etherscan

## Contact

For deployment issues or questions:
- GitHub Issues: [Repository Issues](https://github.com/your-repo/issues)
