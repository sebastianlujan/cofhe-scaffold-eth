"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useDecryptValue } from "~~/app/hooks/useDecrypt";
import { useEncrypt } from "~~/app/hooks/useEncrypt";
import { useZamaFhevm } from "~~/app/hooks/useZamaFhevm";
import { Address } from "~~/components/scaffold-eth";
import { useGaslessOrder } from "~~/hooks/evvm/useGaslessOrder";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getServiceNonce, incrementServiceNonce } from "~~/utils/evvm/secureCache";
import { notification } from "~~/utils/scaffold-eth";

const COFFEE_TYPES = ["espresso", "latte", "cappuccino", "americano"] as const;
const CHAIN_ID = 11155111; // Sepolia

// Icons
const CoffeeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18 8h1a4 4 0 110 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"
    />
    <line x1="6" y1="1" x2="6" y2="4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    <line x1="14" y1="1" x2="14" y2="4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const UnlockIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
    />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
);

const BoltIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

export default function EVVMCafeGaslessPage() {
  const { address } = useAccount();
  const { isInitialized: fhevmConnected, isInitializing } = useZamaFhevm();
  const [initialBalance, setInitialBalance] = useState<string>("1000");
  const [coffeeType, setCoffeeType] = useState<string>("espresso");
  const [quantity, setQuantity] = useState<string>("1");
  const [serviceNonce, setServiceNonce] = useState<number>(() => {
    // Will be initialized properly in useEffect when contract address is available
    return Math.floor(Date.now() / 1000);
  });
  const [fisherStatus, setFisherStatus] = useState<"unknown" | "ready" | "not-configured">("unknown");

  const { encryptUint64, isEncrypting, encryptionDisabled } = useEncrypt();
  const { writeContractAsync: writeEVVMCore, isPending: isPendingCore } = useScaffoldWriteContract({
    contractName: "EVVMCore",
  });

  // Gasless order hook
  const {
    orderGasless,
    state: gaslessState,
    error: gaslessError,
    isLoading: isGaslessLoading,
    canOrder,
  } = useGaslessOrder({
    onSuccess: () => {
      notification.success("Gasless order submitted successfully!");
      // Increment and persist nonce in secure cache
      if (address && evvmCafeGaslessContract?.address) {
        const nextNonce = incrementServiceNonce(CHAIN_ID, evvmCafeGaslessContract.address, address);
        setServiceNonce(nextNonce);
      } else {
        setServiceNonce(prev => prev + 1);
      }
      refetchClientBalance();
      refetchShopBalance();
    },
    onError: error => {
      notification.error(error.message);
    },
  });

  // Get contract addresses
  const { data: evvmCafeGaslessContract } = useDeployedContractInfo({
    contractName: "EVVMCafeGasless" as "EVVMCore",
  });
  const { data: evvmCoreContract } = useDeployedContractInfo({
    contractName: "EVVMCore",
  });

  // Check if client is registered
  const { data: clientVaddrData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getVaddrFromAddress",
    args: [address],
  });
  const clientVaddr = clientVaddrData as `0x${string}` | undefined;

  const isClientRegistered =
    clientVaddr && clientVaddr !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Check if shop is registered
  const {
    data: isShopRegistered,
    refetch: refetchShopStatus,
    isLoading: isLoadingShopStatus,
  } = useScaffoldReadContract({
    contractName: "EVVMCafeGasless" as "EVVMCafe",
    functionName: "isShopRegistered",
  });

  const shopIsRegistered =
    Boolean(isShopRegistered) ||
    (typeof isShopRegistered === "bigint" && isShopRegistered === 1n) ||
    (typeof isShopRegistered === "number" && isShopRegistered === 1);

  // Get coffee price
  const { data: coffeePriceData } = useScaffoldReadContract({
    contractName: "EVVMCafeGasless" as "EVVMCafe",
    functionName: "getCoffeePrice",
    args: [coffeeType],
  });
  const coffeePrice = coffeePriceData as bigint | undefined;

  // Get client balance
  const { data: clientBalanceEncData, refetch: refetchClientBalance } = useScaffoldReadContract({
    contractName: "EVVMCafeGasless" as "EVVMCafe",
    functionName: "getClientBalance",
    args: [address],
  });

  const clientBalanceEnc = clientBalanceEncData as bigint | string | undefined;
  const clientBalanceBigInt = clientBalanceEnc ? BigInt(clientBalanceEnc) : null;
  const {
    onDecrypt: onDecryptClientBalance,
    value: clientBalanceValue,
    state: clientBalanceState,
    error: clientBalanceError,
  } = useDecryptValue(clientBalanceBigInt);

  // Get shop balance
  const { data: shopBalanceEncData, refetch: refetchShopBalance } = useScaffoldReadContract({
    contractName: "EVVMCafeGasless" as "EVVMCafe",
    functionName: "getShopBalance",
  });
  const shopBalanceEnc = shopBalanceEncData as bigint | string | undefined;

  const shopBalanceBigInt = shopBalanceEnc ? BigInt(shopBalanceEnc) : null;
  const {
    onDecrypt: onDecryptShopBalance,
    value: shopBalanceValue,
    state: shopBalanceState,
    error: shopBalanceError,
  } = useDecryptValue(shopBalanceBigInt);

  // Load cached service nonce when contract and wallet are available
  useEffect(() => {
    if (address && evvmCafeGaslessContract?.address) {
      const cachedNonce = getServiceNonce(CHAIN_ID, evvmCafeGaslessContract.address, address);
      setServiceNonce(cachedNonce);
      console.log("[GaslessCafe] Loaded cached nonce:", cachedNonce);
    }
  }, [address, evvmCafeGaslessContract?.address]);

  // Check Fisher status on mount
  useEffect(() => {
    async function checkFisher() {
      try {
        // Use external Fisher URL if configured, otherwise use embedded API
        const fisherUrl = process.env.NEXT_PUBLIC_FISHER_URL;
        const healthEndpoint = fisherUrl ? `${fisherUrl}/health` : "/api/fisher/order";

        const response = await fetch(healthEndpoint);
        if (response.ok) {
          const data = await response.json();
          // External Fisher uses 'status' field, embedded uses 'fisher.configured'
          const isReady = fisherUrl ? data.status === "ok" && data.fisher?.address : data.fisher?.configured;
          setFisherStatus(isReady ? "ready" : "not-configured");
        } else {
          setFisherStatus("not-configured");
        }
      } catch {
        setFisherStatus("not-configured");
      }
    }
    checkFisher();
  }, []);

  // Register client account
  const handleRegisterClient = useCallback(async () => {
    if (!address || !fhevmConnected) {
      notification.error("Please connect wallet and wait for FHEVM to initialize");
      return;
    }

    if (!evvmCoreContract?.address) {
      notification.error("EVVMCore contract address not found");
      return;
    }

    try {
      const balance = BigInt(initialBalance);

      const MAX_INITIAL_BALANCE = 1000000n;
      if (balance > MAX_INITIAL_BALANCE) {
        notification.error(`Initial balance cannot exceed ${MAX_INITIAL_BALANCE.toLocaleString()} tokens`);
        return;
      }

      if (balance <= 0n) {
        notification.error("Initial balance must be greater than 0");
        return;
      }

      notification.info("Encrypting balance...");
      const encrypted = await encryptUint64(evvmCoreContract.address, balance);

      if (!encrypted) {
        notification.error("Failed to encrypt balance");
        return;
      }

      notification.info("Registering account...");
      await writeEVVMCore({
        functionName: "registerAccountFromAddress",
        args: [address, encrypted.handles[0], encrypted.inputProof],
      });

      notification.success("Account registered successfully!");
    } catch (error: unknown) {
      console.error("Register client error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to register account";
      notification.error(errorMessage);
    }
  }, [address, fhevmConnected, initialBalance, encryptUint64, writeEVVMCore, evvmCoreContract]);

  // Register shop
  const handleRegisterShop = useCallback(async () => {
    if (!fhevmConnected) {
      notification.error("Please wait for FHEVM to initialize");
      return;
    }

    if (shopIsRegistered) {
      notification.info("Shop is already registered");
      return;
    }

    if (!evvmCafeGaslessContract?.address || !evvmCoreContract?.address) {
      notification.error("Contract addresses not found");
      return;
    }

    try {
      notification.info("Encrypting zero balance for shop...");
      const encrypted = await encryptUint64(evvmCoreContract.address, 0n);

      if (!encrypted) {
        notification.error("Failed to encrypt balance");
        return;
      }

      notification.info("Registering shop in EVVMCore...");
      await writeEVVMCore({
        functionName: "registerAccountFromAddress",
        args: [evvmCafeGaslessContract.address, encrypted.handles[0], encrypted.inputProof],
      });

      notification.success("Shop registered successfully in EVVMCore!");
      setTimeout(() => refetchShopStatus(), 2000);
    } catch (error: unknown) {
      console.error("Register shop error:", error);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const isAlreadyRegistered =
        errorMessage.includes("ShopAlreadyRegistered") ||
        errorMessage.includes("shop already registered") ||
        errorMessage.includes("address already registered") ||
        errorMessage.includes("account already exists");

      if (isAlreadyRegistered) {
        notification.info("Shop is already registered in EVVM. Refreshing status...");
        setTimeout(() => refetchShopStatus(), 500);
      } else {
        notification.error(errorMessage || "Failed to register shop");
      }
    }
  }, [
    fhevmConnected,
    shopIsRegistered,
    evvmCafeGaslessContract,
    evvmCoreContract,
    encryptUint64,
    writeEVVMCore,
    refetchShopStatus,
  ]);

  // Order coffee (GASLESS!)
  const handleOrderCoffeeGasless = useCallback(async () => {
    if (!canOrder) {
      notification.error("Cannot place order - check wallet and registration status");
      return;
    }

    const qty = BigInt(quantity);
    if (qty <= 0n) {
      notification.error("Quantity must be greater than 0");
      return;
    }

    notification.info("Preparing gasless order...");
    await orderGasless(coffeeType, qty, BigInt(serviceNonce));
  }, [canOrder, quantity, coffeeType, serviceNonce, orderGasless]);

  const isLoading = isEncrypting || isPendingCore || isGaslessLoading;

  // Status message for gasless state
  const getGaslessStatusMessage = () => {
    switch (gaslessState) {
      case "encrypting":
        return "Encrypting payment...";
      case "signing":
        return "Sign the order (no gas!)...";
      case "submitting":
        return "Fisher executing on-chain...";
      case "success":
        return "Order complete!";
      case "error":
        return gaslessError || "Order failed";
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen relative">
      {/* Pattern Background */}
      <div className="evvm-pattern-bg" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#00221E] flex items-center justify-center text-white">
              <CoffeeIcon />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#00221E]">EVVM Cafe</h1>
              <p className="text-gray-600">Demo coffee shop with encrypted FHE payments</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {fisherStatus === "ready" && (
              <span className="evvm-badge evvm-badge-success">
                <BoltIcon />
                Gasless
              </span>
            )}
            {fisherStatus === "not-configured" && <span className="evvm-badge evvm-badge-warning">No Gasless</span>}
            {fhevmConnected ? (
              <span className="evvm-badge evvm-badge-success">
                <CheckIcon />
                FHE Ready
              </span>
            ) : isInitializing ? (
              <span className="evvm-badge evvm-badge-warning">Initializing...</span>
            ) : (
              <span className="evvm-badge evvm-badge-error">Connect to Sepolia</span>
            )}
          </div>
        </div>

        {/* Alerts */}
        {!address && (
          <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200 mb-6">
            <span className="text-yellow-800">Please connect your wallet to continue</span>
          </div>
        )}

        {address && !fhevmConnected && (
          <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200 mb-6">
            <span className="text-yellow-800">
              {isInitializing ? "Initializing FHEVM..." : "Please connect to Sepolia network for FHE features"}
            </span>
          </div>
        )}

        {/* Account Registration */}
        <div className="evvm-card p-6 mb-6">
          <h2 className="text-xl font-semibold mb-2">1. Register Your Account</h2>
          <p className="text-sm text-gray-500 mb-4">
            Register your account in EVVM Core with an initial encrypted balance
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Note: Balance is in <strong>tokens</strong> (not wei). For demo purposes, you can set any balance up to
            1,000,000 tokens.
          </p>

          {isClientRegistered ? (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center gap-2 text-green-800">
                <CheckIcon />
                <span>Account registered!</span>
              </div>
              <div className="mt-2 text-sm text-green-600">
                Virtual Address: <span className="font-mono">{clientVaddr?.slice(0, 20)}...</span>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Initial balance (tokens)</label>
                <input
                  type="text"
                  placeholder="1000"
                  className="evvm-input w-full"
                  value={initialBalance}
                  onChange={e => setInitialBalance(e.target.value)}
                />
              </div>
              <button
                className="btn-evvm px-6 py-3 rounded-lg font-semibold"
                onClick={handleRegisterClient}
                disabled={isLoading || !address || !fhevmConnected || encryptionDisabled}
              >
                {isLoading ? "Loading..." : "Register Account"}
              </button>
            </div>
          )}
        </div>

        {/* Shop Registration */}
        <div className="evvm-card p-6 mb-6">
          <h2 className="text-xl font-semibold mb-2">2. Register Shop (Owner Only)</h2>
          <p className="text-sm text-gray-500 mb-4">
            Register the coffee shop in EVVM Core (must be done before first order)
          </p>

          {isLoadingShopStatus ? (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              <span>Checking shop status...</span>
            </div>
          ) : shopIsRegistered ? (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-800">
                <CheckIcon />
                <span>Shop is registered in EVVM</span>
              </div>
              <button
                className="text-sm text-green-600 hover:text-green-700"
                onClick={() => refetchShopStatus()}
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                className="btn-evvm px-6 py-3 rounded-lg font-semibold"
                onClick={handleRegisterShop}
                disabled={isLoading || !fhevmConnected || encryptionDisabled || shopIsRegistered}
              >
                {isLoading ? "Loading..." : "Register Shop"}
              </button>
              <button
                className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
                onClick={() => refetchShopStatus()}
                disabled={isLoading}
              >
                Check Status
              </button>
            </div>
          )}
        </div>

        {/* Order Coffee */}
        <div className="evvm-card p-6 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xl font-semibold">3. Order Coffee</h2>
            {fisherStatus === "ready" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#00EE96]/20 text-[#00221E] text-xs font-medium">
                <BoltIcon />
                Gasless
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-4">
            {fisherStatus === "ready"
              ? "Sign once to order - no gas required! Fisher executes for you."
              : "Place an order with encrypted payment via EVVM Core"}
          </p>

          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Coffee Type</label>
                <select className="evvm-input w-full" value={coffeeType} onChange={e => setCoffeeType(e.target.value)}>
                  {COFFEE_TYPES.map(type => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                <input
                  type="number"
                  placeholder="1"
                  className="evvm-input w-full"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  min="1"
                />
              </div>
            </div>

            {coffeePrice && (
              <div className="p-3 rounded-lg bg-gray-50 text-sm">
                <div className="flex justify-between">
                  <span>Price per unit:</span>
                  <strong>{coffeePrice.toString()} tokens</strong>
                </div>
                {fisherStatus === "ready" && (
                  <div className="flex justify-between">
                    <span>Priority fee (fisher reward):</span>
                    <strong>1 token</strong>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-200 mt-2 pt-2">
                  <span>Total:</span>
                  <strong>
                    {(coffeePrice * BigInt(quantity || 1) + (fisherStatus === "ready" ? 1n : 0n)).toString()} tokens
                  </strong>
                </div>
              </div>
            )}

            {/* Gasless status */}
            {getGaslessStatusMessage() && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  gaslessState === "error"
                    ? "bg-red-50 text-red-700"
                    : gaslessState === "success"
                      ? "bg-green-50 text-green-700"
                      : "bg-[#00EE96]/10 text-[#00221E]"
                }`}
              >
                <div className="flex items-center gap-2">
                  {gaslessState !== "error" && gaslessState !== "success" && (
                    <div className="w-4 h-4 border-2 border-[#00EE96] border-t-transparent rounded-full animate-spin" />
                  )}
                  {gaslessState === "success" && <CheckIcon />}
                  <span>{getGaslessStatusMessage()}</span>
                </div>
              </div>
            )}

            <button
              className="btn-evvm w-full py-3 rounded-lg font-semibold"
              onClick={handleOrderCoffeeGasless}
              disabled={
                isLoading ||
                !address ||
                !fhevmConnected ||
                !isClientRegistered ||
                !shopIsRegistered ||
                !coffeePrice ||
                encryptionDisabled ||
                fisherStatus !== "ready"
              }
            >
              {isLoading ? "Processing..." : fisherStatus === "ready" ? "Order Coffee (Gasless)" : "Order Coffee"}
            </button>

            {(!address ||
              !fhevmConnected ||
              !isClientRegistered ||
              !shopIsRegistered ||
              !coffeePrice ||
              fisherStatus !== "ready") && (
              <div className="text-xs text-gray-400">
                {!address && "Connect wallet | "}
                {!fhevmConnected && "Initialize FHEVM | "}
                {!isClientRegistered && "Register account | "}
                {!shopIsRegistered && (
                  <>
                    Shop not registered{" "}
                    <button className="text-[#00EE96] hover:underline" onClick={() => refetchShopStatus()}>
                      (refresh)
                    </button>{" "}
                    |{" "}
                  </>
                )}
                {!coffeePrice && "Loading price | "}
                {fisherStatus !== "ready" && "Fisher not ready"}
              </div>
            )}
          </div>
        </div>

        {/* Balances */}
        <div className="evvm-card p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">4. Check Balances</h2>
          <p className="text-sm text-gray-500 mb-4">View encrypted balances (decrypt to see values)</p>

          <div className="space-y-4">
            {/* Client Balance */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
              <div>
                <div className="font-semibold">Your Balance</div>
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  {address ? (
                    <span className="font-mono text-xs">
                      {address.slice(0, 10)}...{address.slice(-6)}
                    </span>
                  ) : (
                    "Not connected"
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {clientBalanceState === "success" && (
                  <span className="text-lg font-bold text-[#00221E]">
                    {clientBalanceValue?.toString() || "0"} tokens
                  </span>
                )}
                {(clientBalanceState === "encrypted" || clientBalanceState === "no-data") && (
                  <>
                    {clientBalanceEnc && BigInt(clientBalanceEnc) !== 0n && (
                      <div className="evvm-encrypted text-xs">{clientBalanceEnc.toString().slice(0, 20)}...</div>
                    )}
                    {(!clientBalanceEnc || BigInt(clientBalanceEnc) === 0n) && (
                      <div className="text-xs text-gray-400">No balance data</div>
                    )}
                    <button
                      className="flex items-center gap-1 text-sm text-[#00EE96] hover:text-[#00D584] font-medium"
                      onClick={onDecryptClientBalance}
                      disabled={!fhevmConnected}
                    >
                      <UnlockIcon />
                      Decrypt
                    </button>
                  </>
                )}
                {clientBalanceState === "pending" && (
                  <div className="w-5 h-5 border-2 border-[#00EE96] border-t-transparent rounded-full animate-spin" />
                )}
                {clientBalanceState === "error" && <span className="text-red-500 text-sm">{clientBalanceError}</span>}
              </div>
            </div>

            {/* Shop Balance */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
              <div>
                <div className="font-semibold">Shop Balance</div>
                <div className="text-sm text-gray-500">Coffee Shop</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {shopBalanceState === "success" && (
                  <span className="text-lg font-bold text-[#00221E]">{shopBalanceValue?.toString() || "0"} tokens</span>
                )}
                {(shopBalanceState === "encrypted" || shopBalanceState === "no-data") && (
                  <>
                    {shopBalanceEnc && BigInt(shopBalanceEnc) !== 0n && (
                      <div className="evvm-encrypted text-xs">{shopBalanceEnc.toString().slice(0, 20)}...</div>
                    )}
                    {(!shopBalanceEnc || BigInt(shopBalanceEnc) === 0n) && (
                      <div className="text-xs text-gray-400">No balance data</div>
                    )}
                    <button
                      className="flex items-center gap-1 text-sm text-[#00EE96] hover:text-[#00D584] font-medium"
                      onClick={onDecryptShopBalance}
                      disabled={!fhevmConnected}
                    >
                      <UnlockIcon />
                      Decrypt
                    </button>
                  </>
                )}
                {shopBalanceState === "pending" && (
                  <div className="w-5 h-5 border-2 border-[#00EE96] border-t-transparent rounded-full animate-spin" />
                )}
                {shopBalanceState === "error" && <span className="text-red-500 text-sm">{shopBalanceError}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Contract Addresses */}
        <div className="evvm-card p-6">
          <h3 className="text-lg font-semibold mb-4">Contract Addresses (Sepolia)</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div>
                <div className="text-xs text-gray-500">EVVMCore</div>
                <Address address={evvmCoreContract?.address} />
              </div>
              <a
                href={`https://sepolia.etherscan.io/address/${evvmCoreContract?.address}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00EE96] hover:text-[#00D584]"
              >
                <ExternalLinkIcon />
              </a>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  EVVMCafeGasless
                  {fisherStatus === "ready" && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#00EE96]/20 text-[#00221E] text-[10px] font-medium">
                      <BoltIcon />
                    </span>
                  )}
                </div>
                <Address address={evvmCafeGaslessContract?.address} />
              </div>
              <a
                href={`https://sepolia.etherscan.io/address/${evvmCafeGaslessContract?.address}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00EE96] hover:text-[#00D584]"
              >
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
          <div className="mt-4 text-center text-sm text-gray-500">
            Network: Sepolia Testnet | SDK: Zama FHEVM Relayer | Mode: Gasless (EIP-712)
          </div>
        </div>
      </div>
    </div>
  );
}
