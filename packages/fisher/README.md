# EVVM Fisher Relayer

A NestJS-based relayer that executes gasless FHE transactions for EVVM.

## How It Works

```
┌──────────────┐     1. Sign EIP-191      ┌──────────────┐     2. Execute tx     ┌────────────────┐
│     User     │ ───────────────────────▶ │    Fisher    │ ───────────────────▶ │   Contract     │
│  (Frontend)  │      (no gas!)           │   (NestJS)   │     (pays gas)       │ (EVVMCafeGasless)
└──────────────┘                          └──────────────┘                      └────────────────┘
                                                │
                                                ▼
                                          Earns priority
                                          fee reward
```

### Gasless Flow

1. **User** encrypts payment amount using FHE (client-side)
2. **User** signs EIP-712 typed data (CoffeeOrderRequest) - **NO GAS REQUIRED**
3. **User** submits signature + encrypted data to Fisher API
4. **Fisher** validates and calls `orderCoffeeGasless()` - **PAYS GAS**
5. **Contract** verifies signature, processes FHE payment, rewards Fisher

## Quick Start

### 1. Install Dependencies

```bash
cd packages/fisher
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# RPC URL for Sepolia
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key

# Fisher wallet private key (this wallet pays gas)
FISHER_PRIVATE_KEY=0x...

# EVVMCafeGasless contract address
EVVM_CAFE_GASLESS_ADDRESS=0x...
```

### 3. Fund Fisher Wallet

The Fisher wallet needs Sepolia ETH to pay for gas:

```bash
# Check your Fisher address
# (will be shown when you start the server)

# Send Sepolia ETH to that address using a faucet:
# https://sepoliafaucet.com/
# https://www.alchemy.com/faucets/ethereum-sepolia
```

### 4. Start the Relayer

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "fisher": {
    "address": "0x...",
    "balance": "0.1 ETH",
    "configured": true
  },
  "contract": {
    "address": "0x...",
    "chainId": 11155111,
    "shopRegistered": true
  }
}
```

### Submit Gasless Order

```bash
POST /order
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

## Architecture

```
packages/fisher/
├── src/
│   ├── main.ts                 # NestJS bootstrap
│   ├── app.module.ts           # Root module
│   ├── config/
│   │   ├── config.module.ts    # Configuration module
│   │   └── config.service.ts   # Environment config
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts  # GET /health
│   ├── order/
│   │   ├── order.module.ts
│   │   ├── order.controller.ts   # POST /order
│   │   ├── order.service.ts      # Business logic
│   │   └── dto/
│   │       └── create-order.dto.ts
│   ├── blockchain/
│   │   ├── blockchain.module.ts
│   │   └── blockchain.service.ts  # Viem client
│   └── contracts/
│       └── evvm-cafe-gasless.abi.ts
├── .env.example
├── nest-cli.json
├── package.json
└── tsconfig.json
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `CHAIN_ID` | Network chain ID | No | `11155111` |
| `RPC_URL` | Ethereum RPC endpoint | Yes | - |
| `FISHER_PRIVATE_KEY` | Relayer wallet private key | Yes | - |
| `EVVM_CAFE_GASLESS_ADDRESS` | Contract address | Yes | - |
| `PORT` | Server port | No | `3001` |
| `MIN_PRIORITY_FEE` | Minimum fee to accept | No | `0` |
| `MIN_GAS_BALANCE` | Alert threshold (wei) | No | `0.01 ETH` |

## Error Handling

The Fisher returns appropriate HTTP status codes:

| Status | Meaning |
|--------|---------|
| `200` | Order executed successfully |
| `400` | Invalid request or contract revert |
| `500` | Internal server error |

Common error messages:

- `Signature has expired` - Deadline has passed
- `Invalid signature` - EIP-712 signature verification failed
- `Service nonce already used` - Retry with a new nonce
- `User not registered in EVVM` - Client must register first
- `Shop not registered in EVVM` - Shop must be registered
- `Insufficient balance for payment` - Client has insufficient funds

## Security Notes

1. **Never commit `.env` with real private keys**
2. The Fisher wallet should only contain enough ETH for gas
3. Priority fees are earned as compensation for gas costs
4. All validation is done on-chain by the smart contract

## License

MIT
