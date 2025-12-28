# EVVM Fisher Relayer

Gasless transaction executor for EVVM on Sepolia.

## Quick Start

```bash
# Start relayer + frontend
yarn dev

# Or start relayer only
yarn dev:relayer
```

## Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| EVVMCore | `0x2a0D846e689D0d63A5dCeED4Eb695Eca5518145D` |
| EVVMCafe | `0x9f6430f2828999D51ea516299a44111cA71d604c` |
| EVVMCafeGasless | `0x7a6Dbe76D2ab54E7D049F8d2a7495658cA713Db9` |
| Fisher Wallet | `0x6CA969Db472182E1aEBa93fBD94274B8019C68a4` |

## Architecture

```
sequenceDiagram
    participant User as User (Frontend)
    participant Relayer as Fisher Relayer
    participant Contract as Smart Contract

    User->>Relayer: 1. Sign EIP-191 (NO GAS)
    User->>Relayer: 2. POST /order
    Relayer->>Contract: 3. Execute tx (PAY GAS)
    Contract-->>Relayer: 4. Tx receipt
    Relayer-->>User: 5. Success response
```

## Startup Order

```
chain -> deploy -> relayer -> frontend
```

| Step | Command | Port |
|------|---------|------|
| 1. Chain | `yarn dev:chain` | 8545 |
| 2. Deploy | `yarn dev:deploy` | - |
| 3. Relayer | `yarn dev:relayer` | 3001 |
| 4. Frontend | `yarn dev:frontend` | 3000 |

Or run all at once:

```bash
yarn dev:all    # Local: chain + deploy + relayer + frontend
yarn dev        # Sepolia: relayer + frontend
```

## API Endpoints

### Health Check

```bash
GET http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-28T06:40:41.143Z",
  "fisher": {
    "address": "0x6CA969Db472182E1aEBa93fBD94274B8019C68a4",
    "balance": "0.02 ETH",
    "configured": true
  },
  "contract": {
    "address": "0x7a6Dbe76D2ab54E7D049F8d2a7495658cA713Db9",
    "chainId": "11155111",
    "shopRegistered": true
  }
}
```

### Submit Gasless Order

```bash
POST http://localhost:3001/order
Content-Type: application/json

{
  "request": {
    "client": "0x...",
    "coffeeType": "espresso",
    "quantity": "1",
    "evvmNonce": "0",
    "serviceNonce": "1",
    "priorityFee": "1",
    "amountCommitment": "0x...",
    "deadline": "1704067200"
  },
  "encryptedAmount": "0x...",
  "inputProof": "0x...",
  "signature": "0x..."
}
```

Response:
```json
{
  "success": true,
  "transactionHash": "0x...",
  "blockNumber": "12345678",
  "gasUsed": "150000"
}
```

## Environment Variables

```bash
# Copy example and configure
cp .env.example .env
```

| Variable | Description | Required |
|----------|-------------|----------|
| `CHAIN_ID` | Network (11155111 = Sepolia) | No |
| `RPC_URL` | Ethereum RPC endpoint | Yes |
| `FISHER_PRIVATE_KEY` | Relayer wallet private key | Yes |
| `PORT` | Server port (default: 3001) | No |
| `MIN_PRIORITY_FEE` | Minimum fee to accept | No |
| `MIN_GAS_BALANCE` | Alert threshold (wei) | No |

## Frontend Integration

The frontend uses `useGaslessOrder` hook:

```typescript
import { useGaslessOrder } from "~~/hooks/evvm/useGaslessOrder";

const { orderGasless, isLoading, error } = useGaslessOrder();

// Order coffee (gasless!)
await orderGasless("latte", 2n, serviceNonce);
```

Flow:
1. Encrypt payment amount with FHE
2. Build EIP-712 typed data
3. User signs (ONE popup, NO gas)
4. Submit to Fisher API
5. Fisher executes on-chain

## CLI Commands

```bash
yarn evvm help        # Show all commands
yarn dev:status       # Check service status
```

```
Service Status:
  Frontend (3000)       RUNNING
  Fisher Relayer (3001) RUNNING
  Hardhat Chain (8545)  STOPPED (using Sepolia)

Fisher Health:
  Wallet: 0x6CA969Db472182E1aEBa93fBD94274B8019C68a4
  Balance: 0.02 ETH
  Shop Registered: Yes
```

## Error Codes

| Status | Meaning |
|--------|---------|
| `200` | Order executed successfully |
| `400` | Invalid request or contract revert |
| `503` | Fisher not configured |
| `500` | Internal server error |

Common errors:
- `Signature has expired` - Deadline passed
- `Invalid signature` - EIP-712 verification failed
- `Service nonce already used` - Use new nonce
- `User not registered in EVVM` - Register first
- `Shop not registered in EVVM` - Register shop
- `Insufficient balance` - Not enough funds
