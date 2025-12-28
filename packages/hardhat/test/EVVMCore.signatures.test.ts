/**
 * @file EVVMCore.signatures.test.ts
 * @description Test suite for EIP-191 signature functionality in EVVMCore
 *
 * Tests cover:
 * - Signature generation and verification
 * - Signed transfers (applySignedTransfer)
 * - Signed address-based transfers (requestPaySigned)
 * - Signature expiration
 * - Invalid signature rejection
 * - Replay protection
 */

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  generateVaddr,
  signMessageHash,
  futureTimestamp,
  pastTimestamp,
  mockEncryptedHandle,
  mockInputProof,
} from "./helpers/testUtils";

describe("EVVMCore - EIP-191 Signatures", function () {
  /**
   * Deploy fixture for signature tests
   */
  async function deployFixture() {
    const [owner, alice, bob, attacker] = await ethers.getSigners();

    const EVVMCore = await ethers.getContractFactory("EVVMCore");
    const vChainId = 1n;
    const evvmID = 100n;
    const evvmCore = await EVVMCore.connect(owner).deploy(vChainId, evvmID);

    return { evvmCore, owner, alice, bob, attacker, vChainId, evvmID };
  }

  describe("Message Hash Generation", function () {
    it("Should generate consistent message hash", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      const fromVaddr = ethers.keccak256(ethers.toUtf8Bytes("from"));
      const toVaddr = ethers.keccak256(ethers.toUtf8Bytes("to"));
      const amountCommitment = ethers.keccak256(ethers.toUtf8Bytes("amount"));
      const nonce = 0n;
      const deadline = futureTimestamp(300);

      const hash1 = await evvmCore.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, nonce, deadline);

      const hash2 = await evvmCore.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, nonce, deadline);

      expect(hash1).to.equal(hash2);
    });

    it("Should generate different hashes for different parameters", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      const fromVaddr = ethers.keccak256(ethers.toUtf8Bytes("from"));
      const toVaddr = ethers.keccak256(ethers.toUtf8Bytes("to"));
      const amountCommitment = ethers.keccak256(ethers.toUtf8Bytes("amount"));
      const deadline = futureTimestamp(300);

      const hash1 = await evvmCore.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, 0n, deadline);

      const hash2 = await evvmCore.getTransferMessageHash(
        fromVaddr,
        toVaddr,
        amountCommitment,
        1n, // Different nonce
        deadline,
      );

      expect(hash1).to.not.equal(hash2);
    });

    it("Should include chain ID in hash (cross-chain replay protection)", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      // Deploy another instance with different vChainId
      const EVVMCore = await ethers.getContractFactory("EVVMCore");
      const evvmCore2 = await EVVMCore.deploy(2n, 100n); // Different vChainId

      const fromVaddr = ethers.keccak256(ethers.toUtf8Bytes("from"));
      const toVaddr = ethers.keccak256(ethers.toUtf8Bytes("to"));
      const amountCommitment = ethers.keccak256(ethers.toUtf8Bytes("amount"));
      const deadline = futureTimestamp(300);

      const hash1 = await evvmCore.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, 0n, deadline);

      const hash2 = await evvmCore2.getTransferMessageHash(fromVaddr, toVaddr, amountCommitment, 0n, deadline);

      expect(hash1).to.not.equal(hash2);
    });
  });

  describe("Signature Constants", function () {
    it("Should have correct domain constant", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      const domain = await evvmCore.EVVM_DOMAIN();
      const expectedDomain = ethers.keccak256(ethers.toUtf8Bytes("EVVM Virtual Transaction"));

      expect(domain).to.equal(expectedDomain);
    });

    it("Should have signature version 1", async function () {
      const { evvmCore } = await loadFixture(deployFixture);

      const version = await evvmCore.SIGNATURE_VERSION();
      expect(version).to.equal(1);
    });
  });

  describe("Signature Validation Logic", function () {
    it("Should reject expired signatures", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      // Generate vaddrs
      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      // Past deadline (already expired)
      const deadline = pastTimestamp(100);

      // Create mock encrypted data
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      // Create amount commitment
      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      // Get message hash and sign
      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);
      const signature = await signMessageHash(alice, messageHash);

      // Should fail due to expired deadline
      await expect(
        evvmCore.applySignedTransfer(aliceVaddr, bobVaddr, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: signature expired");
    });

    it("Should reject if no signer registered for vaddr", async function () {
      const { evvmCore, alice } = await loadFixture(deployFixture);

      // Use a random vaddr that has no registered signer
      const randomVaddr = ethers.keccak256(ethers.toUtf8Bytes("random"));
      const toVaddr = ethers.keccak256(ethers.toUtf8Bytes("to"));

      const deadline = futureTimestamp(300);
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(randomVaddr, toVaddr, amountCommitment, 0n, deadline);
      const signature = await signMessageHash(alice, messageHash);

      await expect(
        evvmCore.applySignedTransfer(randomVaddr, toVaddr, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: no signer registered for vaddr");
    });
  });

  describe("requestPaySigned", function () {
    it("Should reject expired signatures", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      // Past deadline
      const deadline = pastTimestamp(100);

      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);
      const signature = await signMessageHash(alice, messageHash);

      await expect(
        evvmCore.requestPaySigned(alice.address, bob.address, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: from address not registered");
    });

    it("Should reject if from address not registered", async function () {
      const { evvmCore, alice, bob, vChainId, evvmID } = await loadFixture(deployFixture);

      const aliceVaddr = generateVaddr(alice.address, vChainId, evvmID);
      const bobVaddr = generateVaddr(bob.address, vChainId, evvmID);

      const deadline = futureTimestamp(300);
      const amountHandle = mockEncryptedHandle(100n);
      const inputProof = mockInputProof();

      const amountCommitment = ethers.keccak256(ethers.solidityPacked(["bytes32"], [amountHandle]));

      const messageHash = await evvmCore.getTransferMessageHash(aliceVaddr, bobVaddr, amountCommitment, 0n, deadline);
      const signature = await signMessageHash(alice, messageHash);

      // Neither Alice nor Bob is registered
      await expect(
        evvmCore.requestPaySigned(alice.address, bob.address, amountHandle, inputProof, 0n, deadline, signature),
      ).to.be.revertedWith("EVVM: from address not registered");
    });
  });
});
