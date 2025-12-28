# EVVM - Encrypted Virtual Virtual Machine

A privacy-preserving payment system built with Fully Homomorphic Encryption (FHE) using Zama's FHEVM on Ethereum.

## Overview

EVVM (Encrypted Virtual Virtual Machine) is a virtual blockchain layer that enables private payments with encrypted balances. It provides:

- **Private Balances**: Account balances are encrypted using FHE - no one can see how much you have
- **Private Transfers**: Transfer amounts are encrypted - observers only see that a transfer occurred
- **EIP-191 Signed Transfers**: Cryptographic authorization for transactions
- **Plan 2A Secure Transfers**: Two-phase challenge-response authentication with FHE secrets
- **Virtual Blockchain**: Maintains its own block progression and state commitments

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture diagrams.

```
packages/
├── hardhat/                   # Smart contracts & deployment
│   └── contracts/
│       ├── core/
│       │   └── EVVM.core.sol          # FHE payment engine
│       ├── examples/
│       │   ├── EVVMCafe.sol           # Coffee shop integration
│       │   └── EVVMCafeGasless.sol    # Gasless coffee shop
│       └── library/
│           └── FheEvvmService.sol     # Base service contract
├── nextjs/                    # Frontend application
│   └── hooks/evvm/
│       └── useGaslessOrder.ts         # Gasless order hook
├── fisher/                    # Fisher relayer service (NestJS)
│   └── src/
│       ├── order/                     # Order processing
│       └── blockchain/                # Contract interactions
└── cli/
    └── evvm.js                # CLI tool
```

## Quick Start

### Prerequisites

- Node.js >= v20
- Yarn v3+
- Git

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd cofhe-scaffold-eth

# Install dependencies
yarn install
```

### Local Development

**Startup Order:** chain -> deploy -> relayer -> frontend

#### Quick Start (Recommended)

```bash
# Sepolia development (relayer + frontend)
yarn dev

# Full local development (chain + deploy + relayer + frontend)
yarn dev:all

# Check status of all services
yarn dev:status

# See all available commands
yarn evvm help
```

#### Manual Setup (Separate Terminals)

```bash
# Terminal 1: Start local Hardhat chain
yarn dev:chain

# Terminal 2: Deploy contracts (after chain is ready)
yarn dev:deploy

# Terminal 3: Start relayer
yarn dev:relayer

# Terminal 4: Start frontend
yarn dev:frontend
```

### Run Tests

```bash
cd packages/hardhat

# Run all tests (mock FHE)
npx hardhat test --network hardhat

# Run specific test suite
npx hardhat test test/EVVMCore.signatures.test.ts
npx hardhat test test/EVVMCore.plan2a.test.ts
npx hardhat test test/e2e/EVVMCore.flow.test.ts
```

## FHEVM Runtime Modes

The project supports three runtime modes for different development stages:

| Mode | Command | Encryption | Use Case |
|------|---------|------------|----------|
| **Hardhat** | `--network hardhat` | Mock | Fast local testing, CI |
| **Localhost** | `--network localhost` | Mock | Persistent state, frontend testing |
| **Sepolia** | `--network sepolia` | Real FHE | Production validation |

### Testing on Sepolia (Real FHE)

```bash
# 1. Fund your account with Sepolia ETH
# 2. Import your private key
yarn account:import

# 3. Deploy to Sepolia
npx hardhat deploy --network sepolia

# 4. Run real FHE tests
npx hardhat test test/e2e/EVVMCore.sepolia.test.ts --network sepolia
```

## CLI Commands

The EVVM CLI provides a unified interface for managing all services.

**Startup Order:** chain -> deploy -> relayer -> frontend

### Combined Commands

| Command | Description |
|---------|-------------|
| `yarn dev` | Start relayer + frontend (for Sepolia) |
| `yarn dev:all` | Start chain + deploy + relayer + frontend (local) |

### Individual Commands

| Command | Description |
|---------|-------------|
| `yarn dev:chain` | Start local hardhat chain |
| `yarn dev:deploy` | Deploy contracts |
| `yarn dev:relayer` | Start fisher relayer |
| `yarn dev:frontend` | Start frontend |
| `yarn dev:status` | Check status of all services |
| `yarn evvm help` | Show help message |

### Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Fisher Relayer | 3001 | http://localhost:3001 |
| Hardhat Chain | 8545 | http://localhost:8545 |
| Gasless Cafe | 3000 | http://localhost:3000/evvm-cafe-gasless |

## Core Concepts

### Virtual Addresses (vaddr)

EVVM uses virtual addresses instead of Ethereum addresses for privacy:

```solidity
// Generate vaddr from Ethereum address
bytes32 vaddr = evvmCore.generateVaddrFromAddress(userAddress, salt);

// Or register directly
evvmCore.registerAccountFromAddress(userAddress, encryptedBalance, inputProof);
```

### Encrypted Balances

All balances are stored as `euint64` (encrypted 64-bit integers):

```solidity
// Balances are never visible on-chain
euint64 balance; // Only the owner can decrypt this
```

### Transfer Types

#### 1. Basic Transfer (requires sender to submit)

```solidity
evvmCore.applyTransfer(
    fromVaddr,      // Source account
    toVaddr,        // Destination account  
    amount,         // Encrypted amount (externalEuint64)
    inputProof,     // ZK proof for encrypted input
    expectedNonce   // Replay protection
);
```

#### 2. Signed Transfer (third-party can submit)

```solidity
// Create signature off-chain
bytes32 messageHash = evvmCore.getTransferMessageHash(
    fromVaddr, toVaddr, amountCommitment, nonce, deadline
);
Signature sig = signWithEIP191(messageHash, privateKey);

// Anyone can submit the signed transfer
evvmCore.applySignedTransfer(
    fromVaddr, toVaddr, amount, inputProof,
    nonce, deadline, sig
);
```

#### 3. Secure Transfer (Plan 2A - two-phase with FHE secret)

```solidity
// Phase 1: Set up account secret (one-time)
evvmCore.setAccountSecret(vaddr, encryptedSecret, secretProof);

// Phase 2A: Request transfer (creates challenge)
bytes32 challengeId = evvmCore.requestSecureTransfer(
    fromVaddr, toVaddr, amount, inputProof,
    nonce, deadline, sig
);

// Phase 2B: Complete with secret (within 5 minutes)
evvmCore.completeSecureTransfer(challengeId, secret, secretProof);
```

## Integration Guide

### For Payment Applications

```typescript
import { ethers } from "ethers";

// 1. Connect to EVVMCore
const evvmCore = await ethers.getContractAt("EVVMCore", EVVM_CORE_ADDRESS);

// 2. Register user account
const vaddr = await evvmCore.generateVaddrFromAddress(userAddress, ethers.ZeroHash);

// Using FHEVM SDK to encrypt
const encryptedBalance = await fhevm
  .createEncryptedInput(evvmCoreAddress, userAddress)
  .add64(initialBalance)
  .encrypt();

await evvmCore.registerAccount(vaddr, encryptedBalance.handles[0], encryptedBalance.inputProof);

// 3. Make a transfer
const encryptedAmount = await fhevm
  .createEncryptedInput(evvmCoreAddress, userAddress)
  .add64(transferAmount)
  .encrypt();

await evvmCore.applyTransfer(
  senderVaddr,
  recipientVaddr,
  encryptedAmount.handles[0],
  encryptedAmount.inputProof,
  nonce
);
```

### For Merchant Integration (EVVMCafe Example)

```solidity
contract MyShop {
    IEVVMCore public evvmCore;
    
    function processPayment(
        address customer,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 nonce
    ) external {
        // Get customer's vaddr
        bytes32 customerVaddr = evvmCore.getVaddrFromAddress(customer);
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        
        // Process payment
        uint256 txId = evvmCore.requestPay(
            customer,
            address(this),
            amount,
            inputProof,
            nonce
        );
        
        // Emit event for order tracking
        emit PaymentReceived(customer, txId);
    }
}
```

## Security Features

### Replay Protection
- **Nonce-based**: Each account has a sequential nonce
- **Deadline-based**: Signatures expire after specified time
- **Cross-chain**: Chain ID included in signature hash

### Plan 2A Security (Defense in Depth)
1. **Signature verification**: EIP-191 signature required
2. **FHE secret verification**: Encrypted secret must match
3. **Challenge expiry**: 5-minute window to complete
4. **DoS protection**: Nonce only increments on successful completion

### Privacy Guarantees

| Data | Visibility |
|------|------------|
| Account balance | Hidden (encrypted) |
| Transfer amount | Hidden (encrypted) |
| Sender vaddr | Visible in events |
| Recipient vaddr | Visible in events |
| Transaction occurred | Visible |
| Nonce | Public (replay protection) |

## Contract Addresses

### Localhost (Hardhat Node)

| Contract | Address |
|----------|---------|
| EVVMCore | `0x4bf010f1b9beDA5450a8dD702ED602A104ff65EE` |
| EVVMCafe | `0x40a42Baf86Fc821f972Ad2aC878729063CeEF403` |
| Multicall3 | `0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3` |

### Sepolia Testnet (Zama FHEVM)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| EVVMCore | `0xD645DD0cCf4eA74547d3304BC01dd550F3548A50` | [View](https://sepolia.etherscan.io/address/0xD645DD0cCf4eA74547d3304BC01dd550F3548A50#code) |
| EVVMCafe | `0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc` | [View](https://sepolia.etherscan.io/address/0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc#code) |

## API Reference

### EVVMCore Functions

#### Account Management
- `registerAccount(vaddr, initialBalance, inputProof)` - Register new account
- `registerAccountFromAddress(address, initialBalance, inputProof)` - Register via ETH address
- `accountExists(vaddr)` - Check if account exists
- `getNonce(vaddr)` - Get account nonce
- `getEncryptedBalance(vaddr)` - Get encrypted balance handle

#### Transfers
- `applyTransfer(...)` - Basic encrypted transfer
- `applySignedTransfer(...)` - EIP-191 signed transfer
- `requestPay(...)` - Address-based transfer
- `requestPaySigned(...)` - Address-based signed transfer
- `applyTransferBatch(...)` - Batch multiple transfers

#### Secure Transfers (Plan 2A)
- `setAccountSecret(vaddr, secret, proof)` - Set FHE secret
- `requestSecureTransfer(...)` - Phase A: Create challenge
- `completeSecureTransfer(challengeId, secret, proof)` - Phase B: Complete
- `cancelSecureTransfer(challengeId)` - Cancel challenge

#### State Management
- `createVirtualBlock(commitment)` - Create new block
- `updateStateCommitment(commitment)` - Update state
- `getBlockInfo(blockNumber)` - Get block details
- `getVirtualTransaction(txId)` - Get transaction details

### Events

```solidity
event VirtualAccountRegistered(bytes32 indexed vaddr, uint64 initialNonce);
event VirtualTransferApplied(bytes32 indexed fromVaddr, bytes32 indexed toVaddr, euint64 amountEnc, uint64 nonce, uint64 vBlockNumber, uint256 txId);
event SignedTransferApplied(bytes32 indexed fromVaddr, bytes32 indexed toVaddr, address indexed signer, uint64 nonce, uint256 deadline, uint256 txId);
event SecureTransferRequested(bytes32 indexed challengeId, bytes32 indexed fromVaddr, bytes32 indexed toVaddr, uint256 challengeExpiry);
event SecureTransferCompleted(bytes32 indexed challengeId, bytes32 indexed fromVaddr, bytes32 indexed toVaddr, uint64 nonce, uint256 txId);
event SecureTransferCancelled(bytes32 indexed challengeId, bytes32 indexed fromVaddr, string reason);
```

## Testing

### Test Structure

```
test/
├── helpers/
│   ├── testUtils.ts       # Signature helpers, vaddr generation
│   └── mockFHE.ts         # FHE mocking utilities
├── e2e/
│   ├── EVVMCore.flow.test.ts      # Payment flow tests
│   └── EVVMCore.sepolia.test.ts   # Real FHE tests (Sepolia only)
├── EVVMCore.signatures.test.ts    # EIP-191 signature tests
└── EVVMCore.plan2a.test.ts        # Secure transfer tests
```

### Test Results

```
51 passing
4 pending (Sepolia-only real FHE tests)
```

## Development Roadmap

- [x] Phase 1: Zama FHEVM Migration
- [x] Phase 2: EIP-191 Signatures
- [x] Phase 2A: Plan 2A Challenge-Response
- [x] Phase 4: Testing Suite
- [x] Phase 4A: Architecture Refactoring
- [x] Phase 5: Sepolia Deployment
- [ ] Phase 6: Frontend Integration
- [ ] Phase 7: Production Audit

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENCE)

## Resources

- [Zama FHEVM Documentation](https://docs.zama.ai/fhevm)
- [Scaffold-ETH 2 Documentation](https://docs.scaffoldeth.io)
- [EIP-191 Specification](https://eips.ethereum.org/EIPS/eip-191)
