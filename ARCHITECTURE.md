# EVVM Architecture

## Overview

EVVM (Encrypted Virtual Virtual Machine) is a privacy-preserving payment system built with Fully Homomorphic Encryption (FHE) using Zama's FHEVM on Ethereum.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EVVM ARCHITECTURE                                  │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │    USER      │
                              │   (Wallet)   │
                              └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌───────────┐    ┌───────────┐    ┌───────────────┐
            │  ENCRYPT  │    │   SIGN    │    │    SUBMIT     │
            │  Amount   │    │  EIP-712  │    │   to Fisher   │
            │  (FHE)    │    │ (NO GAS)  │    │     API       │
            └───────────┘    └───────────┘    └───────┬───────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FISHER RELAYER (NestJS)                              │
│                         localhost:3001                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│  │   /health   │  │   /order    │  │  Blockchain │                          │
│  │   endpoint  │  │   endpoint  │  │   Service   │                          │
│  └─────────────┘  └──────┬──────┘  └──────┬──────┘                          │
│                          │                │                                  │
│                          └────────────────┘                                  │
│                                  │                                           │
│                         PAYS GAS & EXECUTES                                  │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SEPOLIA BLOCKCHAIN                                   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        EVVMCafeGasless                               │    │
│  │                   (Gasless Coffee Shop)                              │    │
│  │  • Verifies EIP-712 signature                                        │    │
│  │  • Validates amount commitment                                       │    │
│  │  • Processes encrypted payment                                       │    │
│  │  • Rewards fisher                                                    │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│                                  ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           EVVMCore                                   │    │
│  │                    (FHE Payment Engine)                              │    │
│  │  • Virtual accounts (vaddr)                                          │    │
│  │  • Encrypted balances (euint64)                                      │    │
│  │  • FHE transfers (amounts hidden)                                    │    │
│  │  • Nonce management                                                  │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│                                  ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Zama FHEVM Coprocessor                          │    │
│  │              (Fully Homomorphic Encryption Engine)                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Gasless Order Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GASLESS ORDER FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   USER                        FISHER                      BLOCKCHAIN         │
│    │                            │                             │              │
│    │  1. Encrypt amount (FHE)   │                             │              │
│    │─────────────────────────►  │                             │              │
│    │                            │                             │              │
│    │  2. Sign EIP-712 (NO GAS)  │                             │              │
│    │─────────────────────────►  │                             │              │
│    │                            │                             │              │
│    │  3. Submit to Fisher API   │                             │              │
│    │─────────────────────────►  │                             │              │
│    │                            │  4. Execute tx (PAYS GAS)   │              │
│    │                            │────────────────────────────►│              │
│    │                            │                             │              │
│    │                            │  5. Verify sig + transfer   │              │
│    │                            │◄────────────────────────────│              │
│    │                            │                             │              │
│    │  6. Confirmation           │                             │              │
│    │◄─────────────────────────  │                             │              │
│    │                            │                             │              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Breakdown

| Step | Actor | Action | Gas Required |
|------|-------|--------|--------------|
| 1 | User | Encrypts payment amount using FHE (fhevmjs SDK) | No |
| 2 | User | Signs EIP-712 typed data (CoffeeOrderRequest) | No |
| 3 | User | Submits signature + encrypted data to Fisher API | No |
| 4 | Fisher | Validates request and calls `orderCoffeeGasless()` | Yes |
| 5 | Contract | Verifies signature, processes FHE payment | - |
| 6 | User | Receives confirmation | No |

---

## Component Details

### 1. Frontend (NextJS)

```
packages/nextjs/
├── hooks/evvm/
│   └── useGaslessOrder.ts    # Main gasless order hook
├── app/hooks/
│   └── useEncrypt.ts         # FHE encryption hook
└── utils/evvm/
    └── eip712Builder.ts      # EIP-712 typed data builder
```

**Responsibilities:**
- Encrypt payment amounts with FHE
- Build EIP-712 typed data structures
- Request user signature (wallet popup)
- Submit to Fisher API

### 2. Fisher Relayer (NestJS)

```
packages/fisher/
├── src/
│   ├── blockchain/
│   │   └── blockchain.service.ts   # Contract interactions
│   ├── order/
│   │   ├── order.controller.ts     # POST /order endpoint
│   │   └── order.service.ts        # Order execution logic
│   └── health/
│       └── health.controller.ts    # GET /health endpoint
└── .env                            # Fisher wallet config
```

**Responsibilities:**
- Receive signed order requests
- Validate request structure
- Execute on-chain transactions
- Pay gas fees
- Earn priority fee rewards

### 3. Smart Contracts (Solidity)

```
packages/hardhat/contracts/
├── core/
│   └── EVVM.core.sol              # FHE payment engine
├── examples/
│   ├── EVVMCafeGasless.sol        # Gasless coffee shop
│   └── EVVMCafe.sol               # Original (non-gasless)
└── library/
    ├── FheEvvmService.sol         # Base service contract
    └── FheEvvmServiceTypes.sol    # EIP-712 types
```

**EVVMCore Responsibilities:**
- Manage virtual accounts (vaddr)
- Store encrypted balances (euint64)
- Process FHE transfers
- Track nonces

**EVVMCafeGasless Responsibilities:**
- Verify EIP-712 signatures
- Validate amount commitments
- Process gasless orders
- Reward fishers

---

## Key Concepts

### Virtual Addresses (vaddr)

```
vaddr = keccak256(abi.encodePacked(realAddress, vChainId, evvmID))
```

- 32-byte identifier for EVVM accounts
- Deterministically derived from Ethereum address
- Enables privacy (vaddr doesn't reveal real address directly)

### Encrypted Balances

```solidity
euint64 balance;  // FHE-encrypted 64-bit unsigned integer
```

- Balances are stored as FHE ciphertexts
- Operations (add, subtract, compare) happen on encrypted data
- Only account owner can decrypt

### EIP-712 Typed Data

```
CoffeeOrderRequest {
  address client;
  string coffeeType;
  uint256 quantity;
  uint64 evvmNonce;
  uint256 serviceNonce;
  uint256 priorityFee;
  bytes32 amountCommitment;
  uint256 deadline;
}
```

- Structured data for signing
- Human-readable in wallet
- Prevents replay attacks (nonces + deadline)

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SECURITY LAYERS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  PRIVACY (FHE)                                                       │    │
│  │  • Payment amounts are encrypted                                     │    │
│  │  • Only sender/receiver can see actual values                        │    │
│  │  • Blockchain sees only ciphertexts                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  AUTHENTICATION (EIP-712)                                            │    │
│  │  • User signs structured data                                        │    │
│  │  • Signature verified on-chain                                       │    │
│  │  • Prevents unauthorized orders                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  REPLAY PROTECTION                                                   │    │
│  │  • EVVM nonce (payment ordering)                                     │    │
│  │  • Service nonce (order deduplication)                               │    │
│  │  • Deadline (signature expiration)                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ATOMICITY                                                           │    │
│  │  • Signature verification + payment = single transaction             │    │
│  │  • If payment fails, order fails                                     │    │
│  │  • No partial execution                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Insight

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            KEY INSIGHT                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   USER: Signs only (FREE)  ──►  FISHER: Pays gas  ──►  Gets priority fee    │
│                                                                              │
│   Payment amounts are ENCRYPTED - nobody can see how much you're paying!    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| EVVMCore | `0x2a0D846e689D0d63A5dCeED4Eb695Eca5518145D` |
| EVVMCafe | `0x9f6430f2828999D51ea516299a44111cA71d604c` |
| EVVMCafeGasless | `0x7a6Dbe76D2ab54E7D049F8d2a7495658cA713Db9` |

---

## Quick Start

### Using the CLI (Recommended)

```bash
# Start frontend + fisher for Sepolia development
yarn evvm dev

# Or start everything locally (chain + deploy + frontend + fisher)
yarn evvm all

# Check status of all services
yarn evvm status
```

### Manual Setup

```bash
# 1. Start Fisher relayer
yarn fisher:start:dev

# 2. Start frontend
yarn start

# 3. Navigate to /evvm-cafe-gasless and connect wallet
```

---

## CLI Reference

```
╔═══════════════════════════════════════════════════════════╗
║  EVVM - Encrypted Virtual Virtual Machine                 ║
║  Privacy-Preserving Payments with FHE                     ║
╚═══════════════════════════════════════════════════════════╝

Usage: yarn evvm <command>

Commands:
  dev      Start frontend + fisher in development mode
  start    Start frontend only
  fisher   Start fisher relayer only
  chain    Start local hardhat chain
  deploy   Deploy contracts to local chain
  all      Start chain + deploy + frontend + fisher
  status   Check status of all services
  help     Show this help message
```

### Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Fisher Relayer | 3001 | http://localhost:3001 |
| Hardhat Chain | 8545 | http://localhost:8545 |

---

*For detailed status and implementation notes, see [STATUS.md](./STATUS.md)*
