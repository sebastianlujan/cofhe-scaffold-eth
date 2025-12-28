/**
 * Fisher Relayer API - Gasless Order Execution (EIP-191 Version)
 *
 * This endpoint receives signed gasless orders and executes them on-chain.
 * The Fisher (relayer) pays the gas and earns the priority fee from the order.
 *
 * Flow:
 * 1. Receive signed order from user (EIP-191 signature)
 * 2. Validate signature and deadline
 * 3. Execute orderCoffeeGasless() on EVVMCafeGasless contract
 * 4. Return transaction hash to user
 *
 * Environment Variables Required:
 * - FISHER_PRIVATE_KEY: Private key of the Fisher wallet
 * - SEPOLIA_RPC_URL: RPC endpoint for Sepolia (optional, uses Alchemy default)
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, Hex, Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

// ============ Types ============

interface FisherOrderRequest {
  client: Address;
  coffeeType: string;
  quantity: string;
  serviceNonce: string;
  amountCommitment: Hex;
  evvmNonce: string;
  deadline: string;
  priorityFee: string;
  encryptedAmount: Hex;
  inputProof: Hex;
  signature: Hex;
}

// ============ ABI ============

const EVVMCafeGaslessABI = [
  {
    inputs: [
      { internalType: "address", name: "client", type: "address" },
      { internalType: "string", name: "coffeeType", type: "string" },
      { internalType: "uint256", name: "quantity", type: "uint256" },
      { internalType: "uint256", name: "serviceNonce", type: "uint256" },
      { internalType: "bytes32", name: "amountCommitment", type: "bytes32" },
      { internalType: "uint64", name: "evvmNonce", type: "uint64" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "priorityFee", type: "uint256" },
      { internalType: "externalEuint64", name: "encryptedAmount", type: "bytes32" },
      { internalType: "bytes", name: "inputProof", type: "bytes" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "orderCoffeeGasless",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "isShopRegistered",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ============ Configuration ============

const CHAIN_ID = 11155111; // Sepolia

// Contract address - update after deployment
const EVVM_CAFE_GASLESS_ADDRESS = process.env.EVVM_CAFE_GASLESS_ADDRESS || "0x094CeF199FE2a37645cE14D4dfc476E7263ee38B";

// Get Fisher private key from environment
function getFisherAccount() {
  const privateKey = process.env.FISHER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("FISHER_PRIVATE_KEY environment variable not set");
  }

  // Ensure proper hex format
  const formattedKey = privateKey.startsWith("0x") ? (privateKey as Hex) : (`0x${privateKey}` as Hex);
  return privateKeyToAccount(formattedKey);
}

// Get RPC URL
function getRpcUrl(): string {
  if (process.env.SEPOLIA_RPC_URL) {
    return process.env.SEPOLIA_RPC_URL;
  }
  // Fallback to Alchemy
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";
  return `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
}

// ============ Validation ============

function validateRequest(body: unknown): FisherOrderRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const data = body as Record<string, unknown>;

  // Required fields for EIP-191 format
  const requiredFields = [
    "client",
    "coffeeType",
    "quantity",
    "serviceNonce",
    "amountCommitment",
    "evvmNonce",
    "deadline",
    "priorityFee",
    "encryptedAmount",
    "inputProof",
    "signature",
  ];

  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return {
    client: data.client as Address,
    coffeeType: data.coffeeType as string,
    quantity: data.quantity as string,
    serviceNonce: data.serviceNonce as string,
    amountCommitment: data.amountCommitment as Hex,
    evvmNonce: data.evvmNonce as string,
    deadline: data.deadline as string,
    priorityFee: data.priorityFee as string,
    encryptedAmount: data.encryptedAmount as Hex,
    inputProof: data.inputProof as Hex,
    signature: data.signature as Hex,
  };
}

function validateDeadline(deadline: string): void {
  const deadlineTs = BigInt(deadline);
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (deadlineTs <= now) {
    const expired = Number(now - deadlineTs);
    throw new Error(`Signature expired ${expired} seconds ago`);
  }
}

// ============ API Handler ============

export async function POST(req: NextRequest) {
  console.log("[Fisher] Received order request");

  try {
    // Parse and validate request
    const body = await req.json();
    const orderData = validateRequest(body);

    console.log("[Fisher] Order details:", {
      client: orderData.client,
      coffeeType: orderData.coffeeType,
      quantity: orderData.quantity,
      priorityFee: orderData.priorityFee,
    });

    // Validate deadline
    validateDeadline(orderData.deadline);
    console.log("[Fisher] Deadline valid");

    // Get Fisher account
    const account = getFisherAccount();
    console.log("[Fisher] Using account:", account.address);

    // Create clients
    const rpcUrl = getRpcUrl();
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl),
    });

    console.log("[Fisher] Simulating transaction...");

    // Simulate first to check for errors
    try {
      await publicClient.simulateContract({
        address: EVVM_CAFE_GASLESS_ADDRESS as Address,
        abi: EVVMCafeGaslessABI,
        functionName: "orderCoffeeGasless",
        args: [
          orderData.client,
          orderData.coffeeType,
          BigInt(orderData.quantity),
          BigInt(orderData.serviceNonce),
          orderData.amountCommitment,
          BigInt(orderData.evvmNonce),
          BigInt(orderData.deadline),
          BigInt(orderData.priorityFee),
          orderData.encryptedAmount,
          orderData.inputProof,
          orderData.signature,
        ],
        account: account.address,
      });
    } catch (simError) {
      console.error("[Fisher] Simulation failed:", simError);
      const message = simError instanceof Error ? simError.message : "Transaction simulation failed";

      // Try to extract revert reason
      if (message.includes("SignatureExpired")) {
        throw new Error("Signature has expired");
      }
      if (message.includes("InvalidSignature")) {
        throw new Error("Invalid signature");
      }
      if (message.includes("ServiceNonceUsed") || message.includes("ServiceNonceAlreadyUsed")) {
        throw new Error("Service nonce already used");
      }
      if (message.includes("UserNotRegistered")) {
        throw new Error("User not registered in EVVM");
      }
      if (message.includes("ShopNotRegistered")) {
        throw new Error("Shop not registered in EVVM");
      }
      if (message.includes("InsufficientBalance")) {
        throw new Error("Insufficient balance for payment");
      }
      if (message.includes("AmountCommitmentMismatch")) {
        throw new Error("Amount commitment mismatch");
      }

      throw new Error(`Transaction would fail: ${message}`);
    }

    console.log("[Fisher] Simulation passed, executing transaction...");

    // Execute the transaction
    const hash = await walletClient.writeContract({
      address: EVVM_CAFE_GASLESS_ADDRESS as Address,
      abi: EVVMCafeGaslessABI,
      functionName: "orderCoffeeGasless",
      args: [
        orderData.client,
        orderData.coffeeType,
        BigInt(orderData.quantity),
        BigInt(orderData.serviceNonce),
        orderData.amountCommitment,
        BigInt(orderData.evvmNonce),
        BigInt(orderData.deadline),
        BigInt(orderData.priorityFee),
        orderData.encryptedAmount,
        orderData.inputProof,
        orderData.signature,
      ],
    });

    console.log("[Fisher] Transaction submitted:", hash);

    // Wait for confirmation
    console.log("[Fisher] Waiting for confirmation...");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    console.log("[Fisher] Transaction confirmed:", {
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
    });

    if (receipt.status === "reverted") {
      throw new Error("Transaction reverted");
    }

    return NextResponse.json({
      success: true,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    });
  } catch (error) {
    console.error("[Fisher] Error:", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Determine appropriate status code
    let status = 500;
    if (message.includes("expired") || message.includes("Invalid")) {
      status = 400;
    }
    if (message.includes("FISHER_PRIVATE_KEY")) {
      status = 503; // Service unavailable
    }

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

// Health check
export async function GET() {
  try {
    // Check if Fisher is configured
    const hasPrivateKey = !!process.env.FISHER_PRIVATE_KEY;
    const account = hasPrivateKey ? getFisherAccount() : null;

    return NextResponse.json({
      status: "ok",
      fisher: {
        configured: hasPrivateKey,
        address: account?.address || null,
      },
      contract: {
        address: EVVM_CAFE_GASLESS_ADDRESS,
        chainId: CHAIN_ID,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
