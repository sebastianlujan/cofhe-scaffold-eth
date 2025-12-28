"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useDecryptValue } from "~~/app/hooks/useDecrypt";
import { useEncrypt } from "~~/app/hooks/useEncrypt";
import { useZamaFhevm } from "~~/app/hooks/useZamaFhevm";
import { Address, AddressInput } from "~~/components/scaffold-eth";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// Icons as simple SVG components
const ShieldIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    />
  </svg>
);

const LockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
    />
  </svg>
);

const UnlockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
    />
  </svg>
);

const SendIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const ZapIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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

const CoffeeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

export default function ConfidentialEVVMPage() {
  const { address } = useAccount();
  const { isInitialized: fhevmConnected, isInitializing } = useZamaFhevm();

  // Tab state
  const [activeTab, setActiveTab] = useState<"transfer" | "batch" | "faucet">("transfer");

  // Registration state
  const [initialBalance, setInitialBalance] = useState<string>("1000");

  // Transfer state
  const [transferTo, setTransferTo] = useState<string>("");
  const [transferAmount, setTransferAmount] = useState<string>("");
  const [encryptedAmount, setEncryptedAmount] = useState<string | null>(null);
  const [inputProof, setInputProof] = useState<string | null>(null);

  // Batch transfer state
  const [batchRecipients, setBatchRecipients] = useState<Array<{ address: string; amount: string }>>([
    { address: "", amount: "" },
  ]);

  // Faucet state
  const [faucetAmount, setFaucetAmount] = useState<string>("500");

  const { encryptUint64, isEncrypting, encryptionDisabled } = useEncrypt();
  const { writeContractAsync: writeEVVMCore, isPending: isPendingCore } = useScaffoldWriteContract({
    contractName: "EVVMCore",
  });

  // Get contract addresses
  const { data: evvmCoreContract } = useDeployedContractInfo({
    contractName: "EVVMCore",
  });
  const { data: evvmCafeContract } = useDeployedContractInfo({
    contractName: "EVVMCafe",
  });

  // Check if client is registered
  const { data: clientVaddrData, refetch: refetchVaddr } = useScaffoldReadContract({
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

  // Get client balance
  const { data: clientBalanceEncData, refetch: refetchBalance } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getEncryptedBalance",
    args: [clientVaddr as `0x${string}`],
  });
  const clientBalanceEnc = clientBalanceEncData as bigint | string | undefined;
  const clientBalanceBigInt = clientBalanceEnc ? BigInt(clientBalanceEnc) : null;
  const {
    onDecrypt: onDecryptClientBalance,
    value: clientBalanceValue,
    state: clientBalanceState,
  } = useDecryptValue(clientBalanceBigInt);

  // Get recipient vaddr for transfers
  const { data: recipientVaddrData } = useScaffoldReadContract({
    contractName: "EVVMCore",
    functionName: "getVaddrFromAddress",
    args: [transferTo as `0x${string}`],
  });
  const recipientVaddr = recipientVaddrData as `0x${string}` | undefined;
  const isRecipientRegistered =
    recipientVaddr && recipientVaddr !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Register account
  const handleRegisterAccount = useCallback(async () => {
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
      refetchVaddr();
      refetchBalance();
    } catch (error: any) {
      console.error("Register account error:", error);
      notification.error(error.message || "Failed to register account");
    }
  }, [
    address,
    fhevmConnected,
    initialBalance,
    encryptUint64,
    writeEVVMCore,
    evvmCoreContract,
    refetchVaddr,
    refetchBalance,
  ]);

  // Encrypt transfer amount
  const handleEncryptAmount = useCallback(async () => {
    if (!transferAmount || !fhevmConnected || !evvmCoreContract?.address) {
      notification.error("Enter amount and ensure FHEVM is connected");
      return;
    }

    try {
      const amount = BigInt(transferAmount);
      if (amount <= 0n) {
        notification.error("Amount must be greater than 0");
        return;
      }

      notification.info("Encrypting amount...");
      const encrypted = await encryptUint64(evvmCoreContract.address, amount);

      if (!encrypted) {
        notification.error("Failed to encrypt amount");
        return;
      }

      setEncryptedAmount(encrypted.handles[0]);
      setInputProof(encrypted.inputProof);
      notification.success("Amount encrypted!");
    } catch (error: any) {
      console.error("Encrypt error:", error);
      notification.error(error.message || "Failed to encrypt");
    }
  }, [transferAmount, fhevmConnected, evvmCoreContract, encryptUint64]);

  // Execute transfer
  const handleExecuteTransfer = useCallback(async () => {
    if (!encryptedAmount || !inputProof || !clientVaddr || !recipientVaddr || evvmNonce === undefined) {
      notification.error("Please encrypt amount first and ensure both accounts are registered");
      return;
    }

    try {
      notification.info("Executing transfer...");
      await writeEVVMCore({
        functionName: "applyTransfer",
        args: [clientVaddr, recipientVaddr, encryptedAmount as `0x${string}`, inputProof as `0x${string}`, evvmNonce],
      });

      notification.success("Transfer completed!");
      setEncryptedAmount(null);
      setInputProof(null);
      setTransferAmount("");
      setTransferTo("");
      refetchBalance();
    } catch (error: any) {
      console.error("Transfer error:", error);
      notification.error(error.message || "Transfer failed");
    }
  }, [encryptedAmount, inputProof, clientVaddr, recipientVaddr, evvmNonce, writeEVVMCore, refetchBalance]);

  // Faucet - add test tokens
  const handleFaucet = useCallback(async () => {
    if (!address || !fhevmConnected || !clientVaddr || !evvmCoreContract?.address) {
      notification.error("Please register account first");
      return;
    }

    try {
      const amount = BigInt(faucetAmount);
      if (amount <= 0n || amount > 10000n) {
        notification.error("Faucet amount must be between 1 and 10,000");
        return;
      }

      notification.info("Encrypting faucet amount...");
      const encrypted = await encryptUint64(evvmCoreContract.address, amount);

      if (!encrypted) {
        notification.error("Failed to encrypt amount");
        return;
      }

      notification.info("Adding tokens...");
      await writeEVVMCore({
        functionName: "faucetAddBalance",
        args: [clientVaddr, encrypted.handles[0], encrypted.inputProof],
      });

      notification.success(`Added ${faucetAmount} tokens!`);
      refetchBalance();
    } catch (error: any) {
      console.error("Faucet error:", error);
      notification.error(error.message || "Faucet failed");
    }
  }, [
    address,
    fhevmConnected,
    clientVaddr,
    evvmCoreContract,
    faucetAmount,
    encryptUint64,
    writeEVVMCore,
    refetchBalance,
  ]);

  // Batch transfer handlers
  const addBatchRecipient = () => {
    setBatchRecipients([...batchRecipients, { address: "", amount: "" }]);
  };

  const removeBatchRecipient = (index: number) => {
    if (batchRecipients.length > 1) {
      setBatchRecipients(batchRecipients.filter((_, i) => i !== index));
    }
  };

  const updateBatchRecipient = (index: number, field: "address" | "amount", value: string) => {
    const updated = [...batchRecipients];
    updated[index][field] = value;
    setBatchRecipients(updated);
  };

  const isLoading = isEncrypting || isPendingCore;

  return (
    <div className="min-h-screen relative">
      {/* Pattern Background */}
      <div className="evvm-pattern-bg" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#00221E]">Confidential Transfers</h1>
          <p className="text-gray-600 mt-1">Send and receive encrypted payments using Fully Homomorphic Encryption</p>
        </div>

        {/* Status Bar */}
        <div className="evvm-card p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${fhevmConnected ? "bg-green-500" : isInitializing ? "bg-yellow-500 evvm-pulse" : "bg-gray-300"}`}
                />
                <span className="text-sm font-medium text-black">
                  FHE: {fhevmConnected ? "Ready" : isInitializing ? "Initializing..." : "Not Connected"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${address ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-sm font-medium text-black">
                  Wallet: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Not Connected"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isClientRegistered ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="text-sm font-medium text-black">
                  Account: {isClientRegistered ? "Registered" : "Not Registered"}
                </span>
              </div>
            </div>

            {fhevmConnected && (
              <span className="evvm-badge evvm-badge-success">
                <CheckIcon />
                Sepolia
              </span>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Account Info */}
          <div className="space-y-6">
            {/* Account Panel */}
            <div className="evvm-card p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-black">
                <ShieldIcon />
                Your Account
              </h3>

              {!address ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center text-black">
                    <LockIcon />
                  </div>
                  <p className="text-black mb-2">Connect your wallet</p>
                  <p className="text-sm text-gray-600">Connect to Sepolia to use FHE features</p>
                </div>
              ) : !isClientRegistered ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                    <p className="text-sm text-yellow-800 font-medium">Account not registered</p>
                    <p className="text-xs text-yellow-600 mt-1">Register to start using confidential transfers</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Initial Balance (tokens)</label>
                    <input
                      type="number"
                      value={initialBalance}
                      onChange={e => setInitialBalance(e.target.value)}
                      className="evvm-input w-full"
                      placeholder="1000"
                    />
                    <p className="text-xs text-gray-400 mt-1">Max: 1,000,000 tokens</p>
                  </div>

                  <button
                    onClick={handleRegisterAccount}
                    disabled={isLoading || !fhevmConnected || encryptionDisabled}
                    className="btn-evvm w-full py-3 rounded-lg font-semibold disabled:opacity-50"
                  >
                    {isLoading ? "Processing..." : "Register Account"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Balance Display */}
                  <div className="p-4 rounded-lg bg-[#E0FFF2] border border-[#00EE96]/30">
                    <div className="text-xs text-[#00221E]/60 mb-1">Balance</div>
                    {clientBalanceState === "success" ? (
                      <div className="text-2xl font-bold text-[#00221E]">
                        {clientBalanceValue?.toLocaleString() || "0"} tokens
                      </div>
                    ) : clientBalanceState === "pending" ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-[#00EE96] border-t-transparent rounded-full animate-spin" />
                        <span className="text-gray-500">Decrypting...</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="evvm-encrypted">
                          {clientBalanceBigInt ? `0x${clientBalanceBigInt.toString(16).slice(0, 16)}...` : "No data"}
                        </div>
                        <button
                          onClick={onDecryptClientBalance}
                          disabled={!fhevmConnected || clientBalanceState === "no-data"}
                          className="flex items-center gap-2 text-sm text-[#00EE96] hover:text-[#00D584] font-medium disabled:opacity-50"
                        >
                          <UnlockIcon />
                          Decrypt Balance
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Account Details */}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Virtual Address</div>
                      <div className="evvm-encrypted">{clientVaddr?.slice(0, 20)}...</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Nonce</div>
                      <div className="font-mono text-sm">{evvmNonce?.toString() || "0"}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Links */}
            <div className="evvm-card p-6">
              <h3 className="text-lg font-semibold mb-4 text-black">Quick Links</h3>
              <div className="space-y-2">
                <Link
                  href="/evvm-cafe"
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors text-black"
                >
                  <div className="flex items-center gap-3">
                    <CoffeeIcon />
                    <span className="font-medium">EVVM Cafe</span>
                  </div>
                  <span className="text-gray-600">→</span>
                </Link>
                <Link
                  href="/debug"
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors text-black"
                >
                  <div className="flex items-center gap-3">
                    <ShieldIcon />
                    <span className="font-medium">Debug Contracts</span>
                  </div>
                  <span className="text-gray-600">→</span>
                </Link>
                <a
                  href="https://evvm.info/llms-full.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors text-black"
                >
                  <div className="flex items-center gap-3">
                    <ZapIcon />
                    <span className="font-medium">llms-full.txt</span>
                  </div>
                  <ExternalLinkIcon />
                </a>
              </div>
            </div>
          </div>

          {/* Right Column - Operations */}
          <div className="lg:col-span-2">
            {/* Tabs */}
            <div className="evvm-card p-2 mb-4">
              <div className="evvm-tabs">
                <button
                  onClick={() => setActiveTab("transfer")}
                  className={`evvm-tab ${activeTab === "transfer" ? "active" : ""}`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <SendIcon />
                    Transfer
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("batch")}
                  className={`evvm-tab ${activeTab === "batch" ? "active" : ""}`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <ZapIcon />
                    Batch
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("faucet")}
                  className={`evvm-tab ${activeTab === "faucet" ? "active" : ""}`}
                >
                  <span className="flex items-center justify-center gap-2">
                    <ZapIcon />
                    Faucet
                  </span>
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="evvm-card p-6">
              {/* Transfer Tab */}
              {activeTab === "transfer" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                    <div className="flex items-start gap-3">
                      <LockIcon />
                      <div>
                        <div className="font-semibold text-blue-800">Confidential Transfer</div>
                        <p className="text-sm text-blue-600 mt-1">
                          Amount is encrypted client-side using FHE. Only you and the recipient can decrypt.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Recipient Address</label>
                    <AddressInput value={transferTo} onChange={setTransferTo} placeholder="0x..." />
                    {transferTo && (
                      <div className="mt-2 text-xs">
                        {isRecipientRegistered ? (
                          <span className="text-green-600 flex items-center gap-1">
                            <CheckIcon /> Recipient is registered
                          </span>
                        ) : (
                          <span className="text-orange-600">Recipient not registered in EVVM</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount (tokens)</label>
                    <input
                      type="number"
                      value={transferAmount}
                      onChange={e => {
                        setTransferAmount(e.target.value);
                        setEncryptedAmount(null);
                        setInputProof(null);
                      }}
                      className="evvm-input w-full"
                      placeholder="0"
                    />
                  </div>

                  <button
                    onClick={handleEncryptAmount}
                    disabled={!transferAmount || isLoading || !fhevmConnected || encryptionDisabled}
                    className="w-full py-3 rounded-lg font-semibold border-2 border-[#00EE96] text-[#00EE96] hover:bg-[#00EE96] hover:text-[#00221E] transition-colors disabled:opacity-50"
                  >
                    {isEncrypting ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Encrypting...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <LockIcon />
                        Step 1: Encrypt Amount
                      </span>
                    )}
                  </button>

                  {encryptedAmount && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                        <div className="text-xs text-green-600 mb-1">Encrypted Handle</div>
                        <div className="evvm-encrypted text-green-800">{encryptedAmount.slice(0, 30)}...</div>
                      </div>
                      <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                        <div className="text-xs text-green-600 mb-1">Input Proof</div>
                        <div className="evvm-encrypted text-green-800">{inputProof?.slice(0, 30)}...</div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleExecuteTransfer}
                    disabled={!encryptedAmount || !inputProof || !isRecipientRegistered || isLoading}
                    className="btn-evvm w-full py-4 rounded-lg font-bold text-lg disabled:opacity-50"
                  >
                    {isPendingCore ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Executing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <ZapIcon />
                        Step 2: Execute Transfer
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* Batch Tab */}
              {activeTab === "batch" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-lg bg-purple-50 border border-purple-200">
                    <div className="flex items-start gap-3">
                      <ZapIcon />
                      <div>
                        <div className="font-semibold text-purple-800">Batch Transfers</div>
                        <p className="text-sm text-purple-600 mt-1">
                          Send encrypted transfers to multiple recipients in one transaction.
                        </p>
                      </div>
                    </div>
                  </div>

                  {batchRecipients.map((recipient, index) => (
                    <div key={index} className="p-4 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-sm">Recipient {index + 1}</span>
                        {batchRecipients.length > 1 && (
                          <button
                            onClick={() => removeBatchRecipient(index)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={recipient.address}
                          onChange={e => updateBatchRecipient(index, "address", e.target.value)}
                          className="evvm-input w-full"
                          placeholder="Recipient address (0x...)"
                        />
                        <input
                          type="number"
                          value={recipient.amount}
                          onChange={e => updateBatchRecipient(index, "amount", e.target.value)}
                          className="evvm-input w-full"
                          placeholder="Amount"
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={addBatchRecipient}
                    className="w-full py-3 rounded-lg font-medium border-2 border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
                  >
                    + Add Recipient
                  </button>

                  <button
                    disabled={!isClientRegistered || isLoading}
                    className="btn-evvm w-full py-4 rounded-lg font-bold text-lg disabled:opacity-50"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <ZapIcon />
                      Execute Batch Transfer
                    </span>
                  </button>

                  <p className="text-xs text-gray-400 text-center">
                    Batch transfers coming soon - use single transfers for now
                  </p>
                </div>
              )}

              {/* Faucet Tab */}
              {activeTab === "faucet" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                    <div className="flex items-start gap-3">
                      <ZapIcon />
                      <div>
                        <div className="font-semibold text-green-800">Test Token Faucet</div>
                        <p className="text-sm text-green-600 mt-1">
                          Add test tokens to your account for development and testing.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount to Add (max 10,000)</label>
                    <input
                      type="number"
                      value={faucetAmount}
                      onChange={e => setFaucetAmount(e.target.value)}
                      className="evvm-input w-full"
                      placeholder="500"
                      max="10000"
                    />
                  </div>

                  <button
                    onClick={handleFaucet}
                    disabled={!isClientRegistered || isLoading || !fhevmConnected}
                    className="btn-evvm w-full py-4 rounded-lg font-bold text-lg disabled:opacity-50"
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <ZapIcon />
                        Get Test Tokens
                      </span>
                    )}
                  </button>

                  {!isClientRegistered && (
                    <p className="text-sm text-orange-600 text-center">
                      Please register your account first to use the faucet
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Contract Info Footer */}
        <div className="evvm-card p-6 mt-6">
          <h3 className="text-lg font-semibold mb-4 text-[#00221E]">Deployed Contracts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-[#F5F7F4] border border-[#E8EBE6]">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">EVVMCore</div>
              <div className="flex items-center gap-2">
                <Address address={evvmCoreContract?.address} />
                <a
                  href={`https://sepolia.etherscan.io/address/${evvmCoreContract?.address}#code`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00A86B] hover:text-[#00EE96] transition-colors"
                >
                  <ExternalLinkIcon />
                </a>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-[#F5F7F4] border border-[#E8EBE6]">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">EVVMCafe</div>
              <div className="flex items-center gap-2">
                <Address address={evvmCafeContract?.address} />
                <a
                  href={`https://sepolia.etherscan.io/address/${evvmCafeContract?.address}#code`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00A86B] hover:text-[#00EE96] transition-colors"
                >
                  <ExternalLinkIcon />
                </a>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[#E8EBE6] flex items-center justify-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#00EE96]" />
              Sepolia Testnet
            </span>
            <span>|</span>
            <span>Confidential transfers by EVVM</span>
            <span>|</span>
            <a
              href="https://sepolia.etherscan.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00A86B] hover:text-[#00EE96] transition-colors"
            >
              Verified on Etherscan
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
