/* eslint-disable @typescript-eslint/no-unused-vars */
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";

/**
 * @file EVVMCore.test.ts
 * @description Test suite for the EVVMCore contract - Virtual Blockchain with FHE
 *
 * This test suite covers basic functionality:
 * - Account registration
 * - Encrypted balance management
 * - Virtual transfers
 * - Nonce management
 * - Faucet functionality
 */

describe("EVVMCore", function () {
  /**
   * @dev Deploys a fresh instance of the EVVMCore contract for each test
   */
  async function deployEVVMCoreFixture() {
    const [owner, alice, bob] = await hre.ethers.getSigners();

    const EVVMCore = await hre.ethers.getContractFactory("EVVMCore");
    const vChainId = 1n;
    const evvmID = 100n;
    const evvmCore = await EVVMCore.connect(owner).deploy(vChainId, evvmID);

    return { evvmCore, owner, alice, bob, vChainId, evvmID };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial values", async function () {
      const { evvmCore, vChainId, evvmID } = await loadFixture(deployEVVMCoreFixture);

      expect(await evvmCore.vChainId()).to.equal(vChainId);
      expect(await evvmCore.evvmID()).to.equal(evvmID);
      expect(await evvmCore.vBlockNumber()).to.equal(0);
      expect(await evvmCore.nextTxId()).to.equal(1);
    });

    it("Should set the deployer as owner", async function () {
      const { evvmCore, owner } = await loadFixture(deployEVVMCoreFixture);

      expect(await evvmCore.owner()).to.equal(owner.address);
    });
  });

  describe("Account Registration", function () {
    it("Should register a new account with initial balance", async function () {
      const { evvmCore, alice } = await loadFixture(deployEVVMCoreFixture);

      const client = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);

      // Generate a virtual address
      const vaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );

      // Encrypt initial balance of 1000
      const encryptResult = await client.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [encryptedBalance] = await hre.cofhesdk.expectResultSuccess(encryptResult);

      // Register account
      await evvmCore.connect(alice).registerAccount(vaddr, encryptedBalance);

      // Verify account exists
      expect(await evvmCore.accountExists(vaddr)).to.equal(true);

      // Verify initial nonce is 0
      expect(await evvmCore.getNonce(vaddr)).to.equal(0);

      // Verify encrypted balance
      const balance = await evvmCore.getEncryptedBalance(vaddr);
      await hre.cofhesdk.mocks.expectPlaintext(balance, 1000n);
    });

    it("Should fail to register account twice", async function () {
      const { evvmCore, alice } = await loadFixture(deployEVVMCoreFixture);

      const client = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);

      const vaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );

      const encryptResult = await client.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [encryptedBalance] = await hre.cofhesdk.expectResultSuccess(encryptResult);

      await evvmCore.connect(alice).registerAccount(vaddr, encryptedBalance);

      // Try to register again - should fail
      await expect(evvmCore.connect(alice).registerAccount(vaddr, encryptedBalance)).to.be.revertedWith(
        "EVVM: account already exists",
      );
    });

    it("Should generate vaddr from address correctly", async function () {
      const { evvmCore, alice, vChainId, evvmID } = await loadFixture(deployEVVMCoreFixture);

      const generatedVaddr = await evvmCore.generateVaddrFromAddress(alice.address, hre.ethers.ZeroHash);

      const expectedVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, vChainId, evvmID]),
      );

      expect(generatedVaddr).to.equal(expectedVaddr);
    });
  });

  describe("Virtual Transfers", function () {
    it("Should transfer encrypted amount between accounts", async function () {
      const { evvmCore, alice, bob } = await loadFixture(deployEVVMCoreFixture);

      const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);
      const bobClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(bob);

      // Generate virtual addresses
      const aliceVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );
      const bobVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [bob.address, 1n, 100n]),
      );

      // Register Alice with 1000
      const aliceEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [aliceEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(aliceEncryptResult);
      await evvmCore.connect(alice).registerAccount(aliceVaddr, aliceEncryptedBalance);

      // Register Bob with 500
      const bobEncryptResult = await bobClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [bobEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(bobEncryptResult);
      await evvmCore.connect(bob).registerAccount(bobVaddr, bobEncryptedBalance);

      // Transfer 200 from Alice to Bob
      const transferEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(200n)]).encrypt();
      const [transferAmount] = await hre.cofhesdk.expectResultSuccess(transferEncryptResult);

      const tx = await evvmCore.connect(alice).applyTransfer(aliceVaddr, bobVaddr, transferAmount, 0);
      const receipt = await tx.wait();

      // Verify block number incremented
      expect(await evvmCore.vBlockNumber()).to.equal(1);

      // Verify Alice's balance decreased (1000 - 200 = 800)
      const aliceBalance = await evvmCore.getEncryptedBalance(aliceVaddr);
      await hre.cofhesdk.mocks.expectPlaintext(aliceBalance, 800n);

      // Verify Bob's balance increased (500 + 200 = 700)
      const bobBalance = await evvmCore.getEncryptedBalance(bobVaddr);
      await hre.cofhesdk.mocks.expectPlaintext(bobBalance, 700n);

      // Verify Alice's nonce incremented
      expect(await evvmCore.getNonce(aliceVaddr)).to.equal(1);
    });

    it("Should fail transfer with wrong nonce", async function () {
      const { evvmCore, alice, bob } = await loadFixture(deployEVVMCoreFixture);

      const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);
      const bobClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(bob);

      const aliceVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );
      const bobVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [bob.address, 1n, 100n]),
      );

      const aliceEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [aliceEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(aliceEncryptResult);
      await evvmCore.connect(alice).registerAccount(aliceVaddr, aliceEncryptedBalance);

      const bobEncryptResult = await bobClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [bobEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(bobEncryptResult);
      await evvmCore.connect(bob).registerAccount(bobVaddr, bobEncryptedBalance);

      const transferEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(200n)]).encrypt();
      const [transferAmount] = await hre.cofhesdk.expectResultSuccess(transferEncryptResult);

      // Try to transfer with wrong nonce (should be 0, but using 1)
      await expect(evvmCore.connect(alice).applyTransfer(aliceVaddr, bobVaddr, transferAmount, 1)).to.be.revertedWith(
        "EVVM: bad nonce",
      );
    });

    it("Should fail transfer from non-existent account", async function () {
      const { evvmCore, alice, bob } = await loadFixture(deployEVVMCoreFixture);

      const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);
      const bobClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(bob);

      const aliceVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );
      const bobVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [bob.address, 1n, 100n]),
      );

      // Only register Bob
      const bobEncryptResult = await bobClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [bobEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(bobEncryptResult);
      await evvmCore.connect(bob).registerAccount(bobVaddr, bobEncryptedBalance);

      const transferEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(200n)]).encrypt();
      const [transferAmount] = await hre.cofhesdk.expectResultSuccess(transferEncryptResult);

      // Try to transfer from non-existent Alice account
      await expect(evvmCore.connect(alice).applyTransfer(aliceVaddr, bobVaddr, transferAmount, 0)).to.be.revertedWith(
        "EVVM: from account missing",
      );
    });
  });

  describe("Faucet Functionality", function () {
    it("Should add balance via faucet (owner only)", async function () {
      const { evvmCore, owner, alice } = await loadFixture(deployEVVMCoreFixture);

      const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);

      const aliceVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );

      // Register Alice with initial balance
      const initialEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [initialEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(initialEncryptResult);
      await evvmCore.connect(alice).registerAccount(aliceVaddr, initialEncryptedBalance);

      // Owner adds 500 via faucet
      const ownerClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(owner);
      const faucetEncryptResult = await ownerClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [faucetAmount] = await hre.cofhesdk.expectResultSuccess(faucetEncryptResult);

      await evvmCore.connect(owner).faucetAddBalance(aliceVaddr, faucetAmount);

      // Verify balance increased (1000 + 500 = 1500)
      const balance = await evvmCore.getEncryptedBalance(aliceVaddr);
      await hre.cofhesdk.mocks.expectPlaintext(balance, 1500n);

      // Verify nonce didn't change
      expect(await evvmCore.getNonce(aliceVaddr)).to.equal(0);
    });

    it("Should fail faucet from non-owner", async function () {
      const { evvmCore, alice, bob } = await loadFixture(deployEVVMCoreFixture);

      const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);
      const bobClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(bob);

      const aliceVaddr = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["address", "uint64", "uint256"], [alice.address, 1n, 100n]),
      );

      const initialEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
      const [initialEncryptedBalance] = await hre.cofhesdk.expectResultSuccess(initialEncryptResult);
      await evvmCore.connect(alice).registerAccount(aliceVaddr, initialEncryptedBalance);

      const faucetEncryptResult = await bobClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [faucetAmount] = await hre.cofhesdk.expectResultSuccess(faucetEncryptResult);

      // Bob tries to use faucet - should fail
      await expect(evvmCore.connect(bob).faucetAddBalance(aliceVaddr, faucetAmount)).to.be.revertedWithCustomError(
        evvmCore,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should fail faucet for non-existent account", async function () {
      const { evvmCore, owner } = await loadFixture(deployEVVMCoreFixture);

      const ownerClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(owner);

      const fakeVaddr = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("fake"));

      const faucetEncryptResult = await ownerClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
      const [faucetAmount] = await hre.cofhesdk.expectResultSuccess(faucetEncryptResult);

      await expect(evvmCore.connect(owner).faucetAddBalance(fakeVaddr, faucetAmount)).to.be.revertedWith(
        "EVVM: account does not exist",
      );
    });
  });

  describe("Admin Functions", function () {
    it("Should update EVVM ID (owner only)", async function () {
      const { evvmCore, owner } = await loadFixture(deployEVVMCoreFixture);

      const newEvvmID = 200n;
      await evvmCore.connect(owner).setEvvmID(newEvvmID);

      expect(await evvmCore.evvmID()).to.equal(newEvvmID);
    });

    it("Should fail to update EVVM ID from non-owner", async function () {
      const { evvmCore, alice } = await loadFixture(deployEVVMCoreFixture);

      const newEvvmID = 200n;
      await expect(evvmCore.connect(alice).setEvvmID(newEvvmID)).to.be.revertedWithCustomError(
        evvmCore,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Virtual Block Management", function () {
    it("Should create a virtual block with commitment", async function () {
      const { evvmCore, owner } = await loadFixture(deployEVVMCoreFixture);

      const commitment = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("test commitment"));

      const tx = await evvmCore.connect(owner).createVirtualBlock(commitment);
      await tx.wait();

      expect(await evvmCore.vBlockNumber()).to.equal(1);
      expect(await evvmCore.stateCommitment()).to.equal(commitment);

      // Verify block info
      const blockInfo = await evvmCore.getBlockInfo(1);
      expect(blockInfo.blockNumber).to.equal(1);
      expect(blockInfo.stateCommitment).to.equal(commitment);
      expect(blockInfo.exists).to.equal(true);
    });

    it("Should fail to create block with zero commitment", async function () {
      const { evvmCore, owner } = await loadFixture(deployEVVMCoreFixture);

      await expect(evvmCore.connect(owner).createVirtualBlock(hre.ethers.ZeroHash)).to.be.revertedWith(
        "EVVM: commitment cannot be zero",
      );
    });
  });
});
