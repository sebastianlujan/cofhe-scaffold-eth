/**
 * @file EVVMCore.sepolia.test.ts
 * @description Sepolia Testnet tests for EVVMCore with REAL FHE encryption
 *
 * This test suite runs ONLY on Sepolia with real Zama FHEVM encryption.
 * It validates the complete private payment flow with actual encrypted values.
 *
 * Prerequisites:
 * 1. Deploy contracts: npx hardhat deploy --network sepolia
 * 2. Have Sepolia ETH in your account
 *
 * Deployed Contracts (Sepolia):
 * - EVVMCore: 0xD645DD0cCf4eA74547d3304BC01dd550F3548A50
 * - EVVMCafe: 0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc
 *
 * Run with: npx hardhat test test/e2e/EVVMCore.sepolia.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers, fhevm, deployments } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { EVVMCore } from "../../typechain-types";

// Deployed contract addresses on Sepolia (updated after FHEVM v0.9.1 upgrade)
const SEPOLIA_EVVM_CORE = "0x2a0D846e689D0d63A5dCeED4Eb695Eca5518145D";

describe("EVVMCore Sepolia - Real FHE Tests", function () {
  let evvmCore: EVVMCore;
  let evvmCoreAddress: string;
  let signers: { alice: HardhatEthersSigner };

  // Test configuration - used in vaddr generation comments for documentation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const V_CHAIN_ID = 1n;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const EVVM_ID = 100n;

  before(async function () {
    // Skip if not running on Sepolia (chainId: 11155111)
    const { chainId } = await ethers.provider.getNetwork();
    if (chainId !== 11155111n) {
      console.warn("This test suite requires Sepolia Testnet with real FHE.");
      console.warn("Run: npx hardhat test test/e2e/EVVMCore.sepolia.test.ts --network sepolia");
      this.skip();
    }

    // Get deployed contract - use known Sepolia address or from deployments
    try {
      // Try deployments first
      const EVVMCoreDeployment = await deployments.get("EVVMCore");
      evvmCoreAddress = EVVMCoreDeployment.address;
    } catch {
      // Fallback to known Sepolia address
      evvmCoreAddress = SEPOLIA_EVVM_CORE;
    }

    evvmCore = await ethers.getContractAt("EVVMCore", evvmCoreAddress);
    console.log(`EVVMCore at: ${evvmCoreAddress}`);

    // Verify contract is deployed
    const vChainId = await evvmCore.vChainId();
    const evvmID = await evvmCore.evvmID();
    console.log(`  vChainId: ${vChainId}, evvmID: ${evvmID}`);

    const ethSigners = await ethers.getSigners();
    signers = { alice: ethSigners[0] };

    console.log(`Testing with signer: ${signers.alice.address}`);
  });

  describe("Real Encrypted Registration", function () {
    let aliceVaddr: string;
    let step: number;
    const steps = 5;

    function progress(message: string) {
      console.log(`${++step}/${steps} ${message}`);
    }

    beforeEach(() => {
      step = 0;
    });

    it("should register account with real encrypted balance", async function () {
      this.timeout(120000); // 2 minutes for real FHE operations

      // Generate unique vaddr with timestamp salt to avoid conflicts
      const salt = ethers.keccak256(ethers.toUtf8Bytes(`test_${Date.now()}`));
      aliceVaddr = await evvmCore.generateVaddrFromAddress(signers.alice.address, salt);

      progress(`Generated vaddr: ${aliceVaddr.slice(0, 10)}...`);

      // Check if account already exists
      const exists = await evvmCore.accountExists(aliceVaddr);
      if (exists) {
        console.log("Account already exists, skipping registration");
        return;
      }

      progress("Encrypting initial balance (1000)...");
      const encryptedBalance = await fhevm
        .createEncryptedInput(evvmCoreAddress, signers.alice.address)
        .add64(1000n)
        .encrypt();

      progress(`Registering account handle=${ethers.hexlify(encryptedBalance.handles[0]).slice(0, 20)}...`);
      const tx = await evvmCore
        .connect(signers.alice)
        .registerAccount(aliceVaddr, encryptedBalance.handles[0], encryptedBalance.inputProof);

      progress("Waiting for transaction...");
      await tx.wait();

      progress("Verifying registration...");
      expect(await evvmCore.accountExists(aliceVaddr)).to.equal(true);
      expect(await evvmCore.getNonce(aliceVaddr)).to.equal(0n);

      console.log("Registration successful!");
    });
  });

  describe("Real Encrypted Transfer", function () {
    let aliceVaddr: string;
    let bobVaddr: string;
    let step: number;
    const steps = 8;

    function progress(message: string) {
      console.log(`${++step}/${steps} ${message}`);
    }

    beforeEach(() => {
      step = 0;
    });

    it("should transfer with real encrypted amounts", async function () {
      this.timeout(300000); // 5 minutes for multiple FHE operations

      const timestamp = Date.now();
      const aliceSalt = ethers.keccak256(ethers.toUtf8Bytes(`alice_${timestamp}`));
      const bobSalt = ethers.keccak256(ethers.toUtf8Bytes(`bob_${timestamp}`));

      aliceVaddr = await evvmCore.generateVaddrFromAddress(signers.alice.address, aliceSalt);
      bobVaddr = await evvmCore.generateVaddrFromAddress(signers.alice.address, bobSalt);

      // Register Alice
      progress("Encrypting Alice's balance (1000)...");
      const aliceBalance = await fhevm
        .createEncryptedInput(evvmCoreAddress, signers.alice.address)
        .add64(1000n)
        .encrypt();

      progress("Registering Alice...");
      let tx = await evvmCore
        .connect(signers.alice)
        .registerAccount(aliceVaddr, aliceBalance.handles[0], aliceBalance.inputProof);
      await tx.wait();

      // Register Bob
      progress("Encrypting Bob's balance (500)...");
      const bobBalance = await fhevm.createEncryptedInput(evvmCoreAddress, signers.alice.address).add64(500n).encrypt();

      progress("Registering Bob...");
      tx = await evvmCore
        .connect(signers.alice)
        .registerAccount(bobVaddr, bobBalance.handles[0], bobBalance.inputProof);
      await tx.wait();

      // Transfer from Alice to Bob
      progress("Encrypting transfer amount (200)...");
      const transferAmount = await fhevm
        .createEncryptedInput(evvmCoreAddress, signers.alice.address)
        .add64(200n)
        .encrypt();

      progress("Executing transfer Alice -> Bob...");
      tx = await evvmCore.connect(signers.alice).applyTransfer(
        aliceVaddr,
        bobVaddr,
        transferAmount.handles[0],
        transferAmount.inputProof,
        0n, // Alice's nonce
      );
      await tx.wait();

      progress("Verifying nonce increment...");
      const aliceNonce = await evvmCore.getNonce(aliceVaddr);
      expect(aliceNonce).to.equal(1n);

      progress("Transfer complete!");
      console.log(`
=== Transfer Summary ===
From: ${aliceVaddr.slice(0, 10)}...
To: ${bobVaddr.slice(0, 10)}...
Amount: 200 (encrypted)
Alice nonce: ${aliceNonce}
Privacy: Amount is encrypted, only vaddrs visible
`);
    });
  });

  describe("Privacy Verification", function () {
    it("should NOT expose plaintext amounts in events", async function () {
      const network = await ethers.provider.getNetwork();
      if (network.chainId !== 11155111n) {
        this.skip();
      }

      // Get recent VirtualTransferApplied events
      const filter = evvmCore.filters.VirtualTransferApplied();
      const events = await evvmCore.queryFilter(filter, -100);

      if (events.length === 0) {
        console.log("No transfer events found. Run a transfer first.");
        return;
      }

      const latestEvent = events[events.length - 1];
      console.log(`
=== Privacy Check ===
Event: VirtualTransferApplied
From vaddr: ${latestEvent.args?.fromVaddr}
To vaddr: ${latestEvent.args?.toVaddr}
Amount (encrypted handle): ${latestEvent.args?.amountEnc}
Nonce: ${latestEvent.args?.nonce}

The amountEnc is an encrypted handle, NOT the plaintext value.
Only the account owner can decrypt it with their private key.
`);

      // Verify amount is a handle (non-zero, not a small plaintext number)
      const amountHandle = latestEvent.args?.amountEnc;
      expect(amountHandle).to.not.equal(0n);
      // Real encrypted handles are large numbers, not small plaintext values
      expect(amountHandle).to.be.gt(1000000n);
    });
  });
});
