"use client";

import { useCallback, useState } from "react";
import { Hex } from "viem";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { useEncrypt } from "~~/app/hooks/useEncrypt";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import {
  CAFE_SERVICE_ID,
  CoffeeOrderParams,
  DEFAULT_DEADLINE_OFFSET_SECONDS,
  DEFAULT_PRIORITY_FEE,
  buildCoffeeOrderData,
  getTimeUntilDeadline,
  isDeadlineValid,
} from "~~/utils/evvm/eip191Builder";

// ============ Error Message Mapping ============

/**
 * Maps technical/contract error messages to user-friendly messages
 */
function parseErrorToUserMessage(rawError: string): string {
  const errorLower = rawError.toLowerCase();

  // Known error signatures
  if (rawError.includes("0xe58f9c95")) {
    return "Unable to process your order. Please refresh the page and try again.";
  }

  // Signature/auth errors
  if (errorLower.includes("signatureexpired") || errorLower.includes("signature expired")) {
    return "Your order session has expired. Please try again.";
  }
  if (errorLower.includes("invalidsignature") || errorLower.includes("invalid signature")) {
    return "Order verification failed. Please try again.";
  }

  // Nonce errors
  if (errorLower.includes("nonce") && (errorLower.includes("used") || errorLower.includes("already"))) {
    return "This order was already processed. Please refresh and try again.";
  }

  // Registration errors
  if (errorLower.includes("usernotregistered") || errorLower.includes("user not registered")) {
    return "Please register your account before ordering.";
  }
  if (errorLower.includes("shopnotregistered") || errorLower.includes("shop not registered")) {
    return "The coffee shop is currently unavailable. Please try again later.";
  }

  // Balance errors
  if (errorLower.includes("insufficientbalance") || errorLower.includes("insufficient balance")) {
    return "Insufficient balance. Please add more funds to your account.";
  }

  // Generic contract errors
  if (errorLower.includes("reverted") || errorLower.includes("contract function")) {
    return "Unable to process your order. Please try again later.";
  }

  // Network errors
  if (errorLower.includes("timeout") || errorLower.includes("network") || errorLower.includes("fetch")) {
    return "Connection issue. Please check your internet and try again.";
  }

  // Service unavailable
  if (errorLower.includes("503") || errorLower.includes("unavailable")) {
    return "Order service is temporarily unavailable. Please try again later.";
  }

  // Default fallback - don't show technical details
  return "Something went wrong. Please try again.";
}

// ============ Types ============

export type GaslessOrderState = "idle" | "encrypting" | "signing" | "submitting" | "success" | "error";

export interface GaslessOrderResult {
  params: CoffeeOrderParams;
  message: string;
  encryptedAmount: Hex;
  inputProof: Hex;
  signature: Hex;
}

export interface UseGaslessOrderOptions {
  priorityFee?: bigint;
  deadlineSeconds?: number;
  onSuccess?: (result: GaslessOrderResult) => void;
  onError?: (error: Error) => void;
}

export interface UseGaslessOrderReturn {
  // Actions
  prepareAndSign: (coffeeType: string, quantity: bigint, serviceNonce: bigint) => Promise<GaslessOrderResult | null>;
  submitToFisher: (result: GaslessOrderResult) => Promise<boolean>;
  orderGasless: (coffeeType: string, quantity: bigint, serviceNonce: bigint) => Promise<boolean>;
  reset: () => void;

  // State
  state: GaslessOrderState;
  error: string | null;
  lastResult: GaslessOrderResult | null;

  // Derived state
  isLoading: boolean;
  canOrder: boolean;
}

// ============ Hook ============

/**
 * Hook for gasless coffee ordering via EIP-191 signatures
 *
 * Flow:
 * 1. Encrypt payment amount with FHE
 * 2. Build EIP-191 message string
 * 3. User signs (ONE wallet popup, NO gas)
 * 4. Submit to Fisher API
 * 5. Fisher executes on-chain
 *
 * Message Format:
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 *
 * @example
 * ```tsx
 * const { orderGasless, isLoading, error } = useGaslessOrder();
 *
 * const handleOrder = async () => {
 *   const success = await orderGasless("latte", 2n, serviceNonce);
 *   if (success) {
 *     // Order submitted to fisher
 *   }
 * };
 * ```
 */
export function useGaslessOrder(options: UseGaslessOrderOptions = {}): UseGaslessOrderReturn {
  const {
    priorityFee = DEFAULT_PRIORITY_FEE,
    deadlineSeconds = DEFAULT_DEADLINE_OFFSET_SECONDS,
    onSuccess,
    onError,
  } = options;

  // Wagmi hooks
  const { address } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  // Scaffold hooks
  const { encryptUint64 } = useEncrypt();
  const { data: evvmCafeGaslessContract } = useDeployedContractInfo({
    contractName: "EVVMCafeGasless" as "EVVMCore",
  });
  const { data: evvmCoreContract } = useDeployedContractInfo({
    contractName: "EVVMCore",
  });

  // Get client's vaddr to check registration
  const { data: clientVaddrData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getVaddrFromAddress",
    args: [address],
  });
  const clientVaddr = clientVaddrData as Hex | undefined;
  const isClientRegistered =
    clientVaddr && clientVaddr !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Get EVVM nonce for the client
  const { data: evvmNonceData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getNonce",
    args: [clientVaddr as Hex],
  });
  const evvmNonce = evvmNonceData as bigint | undefined;

  // Local state
  const [state, setState] = useState<GaslessOrderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GaslessOrderResult | null>(null);

  // Reset state
  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setLastResult(null);
  }, []);

  // Prepare order and get signature
  const prepareAndSign = useCallback(
    async (coffeeType: string, quantity: bigint, serviceNonce: bigint): Promise<GaslessOrderResult | null> => {
      if (!address || !evvmCafeGaslessContract?.address || !evvmCoreContract?.address) {
        setError("Wallet or contracts not connected");
        setState("error");
        return null;
      }

      if (evvmNonce === undefined) {
        setError("Could not fetch EVVM nonce");
        setState("error");
        return null;
      }

      try {
        // Step 1: Get coffee price and calculate total
        setState("encrypting");
        setError(null);

        // Fetch price for the specific coffee type
        const priceResponse = await fetch(`/api/coffee-price?type=${coffeeType}`);
        let coffeePrice: bigint;

        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          coffeePrice = BigInt(priceData.price);
        } else {
          // Fallback: use a default price mapping
          const defaultPrices: Record<string, bigint> = {
            espresso: 2n,
            latte: 4n,
            cappuccino: 4n,
            americano: 3n,
          };
          coffeePrice = defaultPrices[coffeeType] || 2n;
        }

        const totalPrice = coffeePrice * quantity + priorityFee;

        // Step 2: Encrypt the total amount
        // CRITICAL: For cross-contract FHE calls (gasless transactions):
        // - contractAddress: EVVMCore (where FHE.asEuint64 is called inside requestPay)
        // - userAddress: EVVMCafeGasless (msg.sender when FHE.asEuint64 runs)
        console.log("[GaslessOrder] Encrypting amount:", totalPrice.toString());
        console.log("[GaslessOrder] Encryption target - contract:", evvmCoreContract.address);
        console.log("[GaslessOrder] Encryption target - userAddress:", evvmCafeGaslessContract.address);
        const encrypted = await encryptUint64(evvmCoreContract.address, totalPrice, evvmCafeGaslessContract.address);

        if (!encrypted) {
          throw new Error("Failed to encrypt payment amount");
        }

        const encryptedHandle = encrypted.handles[0];
        const inputProof = encrypted.inputProof;

        // Step 3: Build EIP-191 message
        console.log("[GaslessOrder] Building EIP-191 message...");
        const { message, params } = buildCoffeeOrderData({
          client: address,
          coffeeType,
          quantity,
          evvmNonce,
          serviceNonce,
          encryptedHandle,
          priorityFee,
          deadlineSeconds,
          serviceId: CAFE_SERVICE_ID,
        });

        console.log("[GaslessOrder] Message to sign:", message);

        // Step 4: Request user signature (EIP-191 personal sign)
        setState("signing");
        console.log("[GaslessOrder] Requesting signature...");

        const signature = await signMessageAsync({
          message,
        });

        console.log("[GaslessOrder] Signature received:", signature.slice(0, 20) + "...");

        // Build result
        const result: GaslessOrderResult = {
          params,
          message,
          encryptedAmount: encryptedHandle,
          inputProof,
          signature,
        };

        setLastResult(result);
        return result;
      } catch (err) {
        let message = err instanceof Error ? err.message : "Failed to prepare order";
        console.error("[GaslessOrder] Error:", err);

        // Convert technical errors to user-friendly messages
        if (message.includes("User rejected") || message.includes("user rejected")) {
          message = "Order cancelled.";
        } else if (message.includes("encrypt")) {
          message = "Unable to secure your payment. Please try again.";
        } else if (message.includes("sign")) {
          message = "Signature required to complete your order.";
        }

        setError(message);
        setState("error");
        onError?.(err instanceof Error ? err : new Error(message));
        return null;
      }
    },
    [
      address,
      chainId,
      evvmCafeGaslessContract,
      evvmCoreContract,
      evvmNonce,
      encryptUint64,
      signMessageAsync,
      priorityFee,
      deadlineSeconds,
      onError,
    ],
  );

  // Submit to Fisher API
  const submitToFisher = useCallback(
    async (result: GaslessOrderResult): Promise<boolean> => {
      // Validate deadline hasn't expired
      if (!isDeadlineValid(result.params.deadline)) {
        const expired = getTimeUntilDeadline(result.params.deadline);
        setError(`Signature expired ${Math.abs(expired)} seconds ago`);
        setState("error");
        return false;
      }

      try {
        setState("submitting");
        console.log("[GaslessOrder] Submitting to Fisher API...");

        // Use external Fisher URL if configured, otherwise use embedded API
        const fisherUrl = process.env.NEXT_PUBLIC_FISHER_URL;
        const endpoint = fisherUrl ? `${fisherUrl}/order` : "/api/fisher/order";

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // EIP-191 format - send individual parameters
            client: result.params.client,
            coffeeType: result.params.coffeeType,
            quantity: result.params.quantity.toString(),
            serviceNonce: result.params.serviceNonce.toString(),
            amountCommitment: result.params.amountCommitment,
            evvmNonce: result.params.evvmNonce.toString(),
            deadline: result.params.deadline.toString(),
            priorityFee: result.params.priorityFee.toString(),
            encryptedAmount: result.encryptedAmount,
            inputProof: result.inputProof,
            signature: result.signature,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const rawError = errorData.message || errorData.error || `Fisher API error: ${response.status}`;
          console.error("[GaslessOrder] Fisher error response:", errorData);

          // Parse the raw error and convert to user-friendly message
          const userFriendlyMessage = parseErrorToUserMessage(rawError);
          throw new Error(userFriendlyMessage);
        }

        const data = await response.json();
        console.log("[GaslessOrder] Fisher response:", data);

        setState("success");
        onSuccess?.(result);
        return true;
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : "Failed to submit order";
        console.error("[GaslessOrder] Fisher error:", err);

        // Parse to user-friendly message (error might already be parsed, but this ensures consistency)
        const userMessage = parseErrorToUserMessage(rawMessage);

        setError(userMessage);
        setState("error");
        onError?.(new Error(userMessage));
        return false;
      }
    },
    [onSuccess, onError],
  );

  // Combined flow: prepare, sign, and submit
  const orderGasless = useCallback(
    async (coffeeType: string, quantity: bigint, serviceNonce: bigint): Promise<boolean> => {
      const result = await prepareAndSign(coffeeType, quantity, serviceNonce);
      if (!result) return false;

      return submitToFisher(result);
    },
    [prepareAndSign, submitToFisher],
  );

  // Derived state
  const isLoading = state === "encrypting" || state === "signing" || state === "submitting";
  const canOrder =
    !!address &&
    !!evvmCafeGaslessContract?.address &&
    !!evvmCoreContract?.address &&
    !!isClientRegistered &&
    evvmNonce !== undefined;

  return {
    prepareAndSign,
    submitToFisher,
    orderGasless,
    reset,
    state,
    error,
    lastResult,
    isLoading,
    canOrder,
  };
}

export default useGaslessOrder;
