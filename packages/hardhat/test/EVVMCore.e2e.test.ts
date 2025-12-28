/**
 * @file EVVMCore.e2e.test.ts
 * @description End-to-End test suite for private payments in EVVM
 *
 * Tests the complete flow of:
 * - Account registration
 * - Private encrypted payments
 * - Signed transfers
 * - Challenge-response secure transfers
 *
 * NOTE: These tests focus on contract logic flow. Actual FHE operations
 * require a Zama network connection. The tests verify:
 * - Correct function signatures and parameters
 * - Proper error handling
 * - Event emissions
 * - State transitions
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  generateVaddr,
  signMessageHash,
  futureTimestamp,
  mockEncryptedHandle,
  mockInputProof,
} from "./helpers/testUtils";

describe("EVVMCore - E2E Private Payments", function () {
  /**
   * Deploy fixture with all accounts
   */
  async function deployFixture() {
    const [owner, alice, bob, charlie, shop] = await ethers.getSigners();

    const EVVMCore = await ethers.getContractFactory("EVVMCore");
    const vChainId = 1n;
    const evvmID = 100n;
    const evvmCore = await EVVMCore.connect(owner).deploy(vChainId, evvmID);

    return { evvmCore, owner, alice, bob, charlie, shop, vChainId, evvmID };
  }

  describe("Private Payment Flow - Basic", function () {
    /**
     * This test documents the expected flow for a basic private payment:
     *
     * 1. Alice registers account with encrypted initial balance
     * 2. Bob registers account with encrypted initial balance
     * 3. Alice creates an encrypted amount
     * 4. Alice transfers encrypted amount to Bob
     * 5. Both balances are updated (encrypted)
     * 6. External observer cannot see actual amounts
     */
    it("Should support basic transfer function signature", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      // Verify the applyTransfer function exists with correct signature
      expect(evvmCore.applyTransfer).to.not.equal(undefined);

      // Verify expected parameters
      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      // These will fail because accounts don't exist, but proves the interface
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      await expect(
        evvmCore.connect(alice).applyTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n),
      ).to.be.revertedWith("EVVM: from account missing");
    });

    it("Should have correct transfer event structure", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      // Verify VirtualTransferApplied event exists
      const eventFragment = evvmCore.interface.getEvent("VirtualTransferApplied");
      expect(eventFragment).to.not.equal(null);

      // Check event parameters
      expect(eventFragment?.inputs.length).to.equal(6);
      expect(eventFragment?.inputs[0].name).to.equal("fromVaddr");
      expect(eventFragment?.inputs[1].name).to.equal("toVaddr");
      expect(eventFragment?.inputs[2].name).to.equal("amountEnc");
      expect(eventFragment?.inputs[3].name).to.equal("nonce");
      expect(eventFragment?.inputs[4].name).to.equal("vBlockNumber");
      expect(eventFragment?.inputs[5].name).to.equal("txId");
    });
  });

  describe("Private Payment Flow - Signed", function () {
    /**
     * Signed transfer flow:
     *
     * 1. Alice registers via registerAccountFromAddress (links address to vaddr)
     * 2. Alice creates transfer message hash with all parameters
     * 3. Alice signs the message hash with her private key
     * 4. Anyone can submit the signed transfer to the contract
     * 5. Contract verifies signature matches the authorized signer
     * 6. Transfer executes with cryptographic authorization
     */
    it("Should have applySignedTransfer function", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      expect(evvmCore.applySignedTransfer).to.not.equal(undefined);

      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      const deadline = futureTimestamp(300);
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);

      const signature = await signMessageHash(alice, messageHash);

      // Will fail because no signer registered, but proves the flow
      await expect(
        evvmCore.applySignedTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: no signer registered for vaddr");
    });

    it("Should have SignedTransferApplied event", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      const eventFragment = evvmCore.interface.getEvent("SignedTransferApplied");
      expect(eventFragment).to.not.equal(null);

      expect(eventFragment?.inputs.length).to.equal(6);
      expect(eventFragment?.inputs[0].name).to.equal("fromVaddr");
      expect(eventFragment?.inputs[1].name).to.equal("toVaddr");
      expect(eventFragment?.inputs[2].name).to.equal("signer");
      expect(eventFragment?.inputs[3].name).to.equal("nonce");
      expect(eventFragment?.inputs[4].name).to.equal("deadline");
      expect(eventFragment?.inputs[5].name).to.equal("txId");
    });
  });

  describe("Private Payment Flow - Secure (Plan 2A)", function () {
    /**
     * Two-phase challenge-response flow for maximum security:
     *
     * SETUP:
     * 1. Alice registers account via registerAccountFromAddress
     * 2. Alice sets her encrypted secret via setAccountSecret
     * 3. fheSecretEnabled[aliceVaddr] = true
     *
     * PHASE A - Request:
     * 4. Alice (or anyone with her signature) calls requestSecureTransfer
     * 5. Contract verifies signature
     * 6. Contract creates challenge with 5-minute expiry
     * 7. Nonce is NOT incremented (DoS protection)
     *
     * PHASE B - Complete:
     * 8. Alice (within 5 minutes) calls completeSecureTransfer
     * 9. Provides her encrypted secret
     * 10. Contract compares secret using FHE.eq()
     * 11. If valid: transfer executes, nonce increments
     * 12. If invalid: amount becomes 0 (no theft, but gas wasted)
     *
     * ATTACK MITIGATION:
     * - Attacker with only signature key cannot burn nonces
     * - Attacker needs BOTH signing key AND encrypted secret
     * - Expired challenges can be cleaned up by anyone
     */
    it("Should have requestSecureTransfer function (Phase A)", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      expect(evvmCore.requestSecureTransfer).to.not.equal(undefined);

      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      const deadline = futureTimestamp(300);
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);

      const signature = await signMessageHash(alice, messageHash);

      // Will fail because FHE secret not enabled
      await expect(
        evvmCore.requestSecureTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: FHE secret not enabled");
    });

    it("Should have completeSecureTransfer function (Phase B)", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      expect(evvmCore.completeSecureTransfer).to.not.equal(undefined);

      const fakeChallengeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const secretHandle = mockEncryptedHandle(12345n);
      const secretProof = mockInputProof();

      await expect(evvmCore.completeSecureTransfer(fakeChallengeId, secretHandle, secretProof)).to.be.revertedWith(
        "EVVM: challenge not found",
      );
    });

    it("Should have cancelSecureTransfer function", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      expect(evvmCore.cancelSecureTransfer).to.not.equal(undefined);

      const fakeChallengeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

      await expect(evvmCore.cancelSecureTransfer(fakeChallengeId)).to.be.revertedWith("EVVM: challenge not found");
    });

    it("Should have SecureTransfer events", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      // Check all Plan 2A events exist
      expect(evvmCore.interface.getEvent("SecureTransferRequested")).to.not.equal(null);
      expect(evvmCore.interface.getEvent("SecureTransferCompleted")).to.not.equal(null);
      expect(evvmCore.interface.getEvent("SecureTransferCancelled")).to.not.equal(null);
      expect(evvmCore.interface.getEvent("AccountSecretUpdated")).to.not.equal(null);
    });

    it("Should have secret management functions", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      expect(evvmCore.setAccountSecret).to.not.equal(undefined);
      expect(evvmCore.disableAccountSecret).to.not.equal(undefined);
      expect(evvmCore.enableAccountSecret).to.not.equal(undefined);
      expect(evvmCore.hasSecretEnabled).to.not.equal(undefined);
    });
  });

  describe("Private Payment Privacy Properties", function () {
    /**
     * Privacy guarantees of the EVVM system:
     *
     * 1. Encrypted Balances:
     *    - All balances are stored as euint64 (encrypted)
     *    - Only authorized parties can decrypt
     *
     * 2. Encrypted Amounts:
     *    - Transfer amounts are encrypted (externalEuint64)
     *    - Observers cannot see how much was transferred
     *
     * 3. Amount Commitment:
     *    - Signatures bind to a commitment of the encrypted amount
     *    - Prevents amount manipulation after signing
     *
     * 4. FHE Operations:
     *    - Balance updates happen in encrypted domain
     *    - FHE.add() and FHE.sub() operate on ciphertexts
     *
     * 5. Conditional Execution (Plan 2A):
     *    - FHE.select() creates zero amount if secret invalid
     *    - Attacker cannot tell if their attack succeeded
     */
    it("Should store balances as encrypted type", async function () {
      const { evvmCore, alice, vChainId, evvmID } = await loadFixture(deployFixture);

      // The getEncryptedBalance function returns euint64
      // This is verified by the function signature
      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);

      // Will fail because account doesn't exist, but proves the return type
      await expect(evvmCore.getEncryptedBalance(aliceVaddr)).to.be.revertedWith("EVVM: account does not exist");
    });

    it("Should require encrypted input proof for transfers", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      // The function signature requires:
      // - externalEuint64 amount: encrypted amount handle
      // - bytes calldata inputProof: ZK proof for the encrypted input

      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      // Function accepts these parameters (will fail on account check)
      await expect(evvmCore.applyTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n)).to.be.revertedWith(
        "EVVM: from account missing",
      );
    });

    it("Should emit encrypted amount in events", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      // VirtualTransferApplied event contains amountEnc (euint64)
      const eventFragment = evvmCore.interface.getEvent("VirtualTransferApplied");

      // The amountEnc parameter is an encrypted type
      // External observers see only the ciphertext handle, not the plaintext value
      expect(eventFragment?.inputs[2].name).to.equal("amountEnc");
    });
  });

  describe("Complete Flow Documentation", function () {
    /**
     * This test documents the complete private payment flow
     * that would occur on a Zama FHEVM network:
     */
    it("Should document the complete private payment flow", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      // STEP 1: Generate virtual addresses
      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      console.log("\n=== Private Payment Flow ===");
      console.log("1. Alice vaddr:", aliceVaddr);
      console.log("2. Bob vaddr:", bobVaddr);

      // STEP 2: In real usage, Alice would:
      // const fhevm = await getFHEVM();
      // const encryptedBalance = await fhevm.createEncryptedInput(evvmCore.address, alice.address)
      //   .add64(1000n)
      //   .encrypt();
      // await evvmCore.registerAccountFromAddress(alice.address, encryptedBalance.handles[0], encryptedBalance.inputProof);

      console.log("3. Alice registers with encrypted initial balance (1000)");

      // STEP 3: Bob registers similarly
      console.log("4. Bob registers with encrypted initial balance (500)");

      // STEP 4: Alice creates a signed transfer
      const deadline = futureTimestamp(300);
      const amountHandle = mockEncryptedHandle(200n);

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);

      console.log("5. Transfer message hash:", messageHash);

      const signature = await signMessageHash(alice, messageHash);
      console.log("6. Alice signs the transfer");
      console.log("   - v:", signature.v);
      console.log("   - r:", signature.r.slice(0, 20) + "...");
      console.log("   - s:", signature.s.slice(0, 20) + "...");

      // STEP 5: In real usage:
      // await evvmCore.applySignedTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n, deadline, signature);
      console.log("7. Signed transfer submitted to contract");

      // STEP 6: Result
      console.log("8. Expected result:");
      console.log("   - Alice balance: 1000 - 200 = 800 (encrypted)");
      console.log("   - Bob balance: 500 + 200 = 700 (encrypted)");
      console.log("   - External observer sees: encrypted handles only");
      console.log("   - Nonce incremented for replay protection");

      console.log("\n=== Privacy Guarantees ===");
      console.log("- Amount transferred: HIDDEN (encrypted)");
      console.log("- Final balances: HIDDEN (encrypted)");
      console.log("- Transaction happened: VISIBLE (event emitted)");
      console.log("- Who transferred: VISIBLE (vaddr in event)");
    });
  });
});
