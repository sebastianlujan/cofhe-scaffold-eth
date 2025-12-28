"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useDecryptValue } from "~~/app/hooks/useDecrypt";
import { useEncrypt } from "~~/app/hooks/useEncrypt";
import { useZamaFhevm } from "~~/app/hooks/useZamaFhevm";
import { Address } from "~~/components/scaffold-eth";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const COFFEE_TYPES = ["espresso", "latte", "cappuccino", "americano"] as const;

// Icons
const ArrowLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

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

export default function EVVMCafePage() {
  const { address } = useAccount();
  const { isInitialized: fhevmConnected, isInitializing } = useZamaFhevm();
  const [initialBalance, setInitialBalance] = useState<string>("1000");
  const [coffeeType, setCoffeeType] = useState<string>("espresso");
  const [quantity, setQuantity] = useState<string>("1");
  const [serviceNonce, setServiceNonce] = useState<number>(1);

  const { encryptUint64, isEncrypting, encryptionDisabled } = useEncrypt();
  const { writeContractAsync: writeEVVMCore, isPending: isPendingCore } = useScaffoldWriteContract({
    contractName: "EVVMCore",
  });
  const { writeContractAsync: writeEVVMCafe, isPending: isPendingCafe } = useScaffoldWriteContract({
    contractName: "EVVMCafe",
  });

  // Get contract addresses
  const { data: evvmCafeContract } = useDeployedContractInfo({
    contractName: "EVVMCafe",
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

  // Get EVVM nonce
  const { data: evvmNonceData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getNonce",
    args: [clientVaddr as `0x${string}`],
  });
  const evvmNonce = evvmNonceData as bigint | undefined;

  // Get nextTxId to calculate payment txId after payment
  const { data: nextTxIdData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "nextTxId",
  });
  const nextTxId = nextTxIdData as bigint | undefined;

  // Check if shop is registered
  const {
    data: isShopRegistered,
    refetch: refetchShopStatus,
    isLoading: isLoadingShopStatus,
  } = useScaffoldReadContract({
    contractName: "EVVMCafe",
    functionName: "isShopRegistered",
  });

  const shopIsRegistered =
    Boolean(isShopRegistered) ||
    (typeof isShopRegistered === "bigint" && isShopRegistered === 1n) ||
    (typeof isShopRegistered === "number" && isShopRegistered === 1);

  // Debug: Log shop registration status
  useEffect(() => {
    if (isShopRegistered !== undefined) {
      console.log("Shop registration status:", {
        raw: isShopRegistered,
        type: typeof isShopRegistered,
        boolean: Boolean(isShopRegistered),
        shopIsRegistered,
      });
    }
  }, [isShopRegistered, shopIsRegistered]);

  // Get coffee price
  const { data: coffeePriceData } = useScaffoldReadContract({
    contractName: "EVVMCafe",
    functionName: "getCoffeePrice",
    args: [coffeeType],
  });
  const coffeePrice = coffeePriceData as bigint | undefined;

  // Get client balance
  const { data: clientBalanceEncData, refetch: refetchClientBalance } = useScaffoldReadContract({
    contractName: "EVVMCafe",
    functionName: "getClientBalance",
    args: [address],
  });

  // Convert to bigint for decryption hook (handle various return types)
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
    contractName: "EVVMCafe",
    functionName: "getShopBalance",
  });
  const shopBalanceEnc = shopBalanceEncData as bigint | string | undefined;

  // Convert to bigint for decryption hook
  const shopBalanceBigInt = shopBalanceEnc ? BigInt(shopBalanceEnc) : null;
  const {
    onDecrypt: onDecryptShopBalance,
    value: shopBalanceValue,
    state: shopBalanceState,
    error: shopBalanceError,
  } = useDecryptValue(shopBalanceBigInt);

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

      // Validation: Limit initial balance to prevent abuse (max 1,000,000 tokens)
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
    } catch (error: any) {
      console.error("Register client error:", error);
      notification.error(error.message || "Failed to register account");
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

    if (!evvmCafeContract?.address || !evvmCoreContract?.address) {
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
        args: [evvmCafeContract.address, encrypted.handles[0], encrypted.inputProof],
      });

      notification.success("Shop registered successfully in EVVMCore!");
      setTimeout(() => refetchShopStatus(), 2000);
    } catch (error: any) {
      console.error("Register shop error:", error);

      const errorMessage = error.message || error.toString() || "";
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
    evvmCafeContract,
    evvmCoreContract,
    encryptUint64,
    writeEVVMCore,
    refetchShopStatus,
  ]);

  // Order coffee
  const handleOrderCoffee = useCallback(async () => {
    if (!address || !fhevmConnected || !coffeePrice || evvmNonce === undefined) {
      notification.error("Please connect wallet, wait for FHEVM, and ensure shop is registered");
      return;
    }

    if (!evvmCafeContract?.address || !evvmCoreContract?.address) {
      notification.error("Contract addresses not found");
      return;
    }

    try {
      const qty = BigInt(quantity);
      const totalPrice = coffeePrice * qty;

      // Step 1: Encrypt the price
      notification.info("Encrypting payment amount...");
      const encrypted = await encryptUint64(evvmCoreContract.address, totalPrice);

      if (!encrypted) {
        notification.error("Failed to encrypt price");
        return;
      }

      // Step 2: Get the current nextTxId before payment
      const currentNextTxId = nextTxId ? BigInt(nextTxId.toString()) : 0n;

      // Step 3: Call EVVMCore.requestPay()
      notification.info("Processing payment...");
      await writeEVVMCore({
        functionName: "requestPay",
        args: [address, evvmCafeContract.address, encrypted.handles[0], encrypted.inputProof, evvmNonce],
      });

      // Step 4: Calculate the payment txId
      const paymentTxId = currentNextTxId;

      // Step 5: Call EVVMCafe.orderCoffee()
      notification.info("Registering order...");
      await writeEVVMCafe({
        functionName: "orderCoffee",
        args: [address, coffeeType, qty, paymentTxId, BigInt(serviceNonce), evvmNonce] as const,
      });

      notification.success("Coffee ordered successfully!");
      setServiceNonce(prev => prev + 1);
      refetchClientBalance();
      refetchShopBalance();
    } catch (error: any) {
      console.error("Order coffee error:", error);
      notification.error(error.message || "Failed to order coffee");
    }
  }, [
    address,
    fhevmConnected,
    coffeePrice,
    quantity,
    coffeeType,
    serviceNonce,
    evvmNonce,
    nextTxId,
    evvmCafeContract,
    evvmCoreContract,
    encryptUint64,
    writeEVVMCore,
    writeEVVMCafe,
    refetchClientBalance,
    refetchShopBalance,
  ]);

  const isLoading = isEncrypting || isPendingCore || isPendingCafe;

  return (
    <div className="min-h-screen relative">
      {/* Pattern Background */}
      <div className="evvm-pattern-bg" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="evvm-card p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
                <ArrowLeftIcon />
              </Link>
              <div className="w-12 h-12 rounded-xl bg-[#00221E] flex items-center justify-center">
                <CoffeeIcon />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#00221E]">EVVM Cafe</h1>
                <p className="text-sm text-gray-500">Private coffee shop with encrypted payments</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
          <h2 className="text-xl font-semibold mb-2">3. Order Coffee</h2>
          <p className="text-sm text-gray-500 mb-4">Place an order with encrypted payment via EVVM Core</p>

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
                Price per unit: <strong>{coffeePrice.toString()} tokens</strong> | Total:{" "}
                <strong>{(coffeePrice * BigInt(quantity || 1)).toString()} tokens</strong>
              </div>
            )}

            <button
              className="btn-evvm w-full py-3 rounded-lg font-semibold"
              onClick={handleOrderCoffee}
              disabled={
                isLoading ||
                !address ||
                !fhevmConnected ||
                !isClientRegistered ||
                !shopIsRegistered ||
                !coffeePrice ||
                evvmNonce === undefined ||
                encryptionDisabled
              }
            >
              {isLoading ? "Processing..." : "Order Coffee"}
            </button>

            {(!address ||
              !fhevmConnected ||
              !isClientRegistered ||
              !shopIsRegistered ||
              !coffeePrice ||
              evvmNonce === undefined) && (
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
                {evvmNonce === undefined && "Loading nonce"}
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
                <div className="text-xs text-gray-500">EVVMCafe</div>
                <Address address={evvmCafeContract?.address} />
              </div>
              <a
                href={`https://sepolia.etherscan.io/address/${evvmCafeContract?.address}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00EE96] hover:text-[#00D584]"
              >
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
          <div className="mt-4 text-center text-sm text-gray-500">
            Network: Sepolia Testnet | SDK: Zama FHEVM Relayer
          </div>
        </div>
      </div>
    </div>
  );
}
