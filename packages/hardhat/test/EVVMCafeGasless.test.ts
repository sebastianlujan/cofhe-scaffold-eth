/**
 * EVVMCafeGasless Test Suite - EIP-191 Version
 *
 * Tests for gasless coffee ordering with FHE encrypted payments.
 *
 * EIP-191 Message Format:
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 */

import { expect } from "chai";
import hre from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { keccak256, toUtf8Bytes, solidityPackedKeccak256 } from "ethers";

// ============ Deployment Helpers ============

async function deployEVVMCore() {
  const EVVMCore = await hre.ethers.getContractFactory("EVVMCore");
  const evvmCore = await EVVMCore.deploy(11155111n, 100n);
  return evvmCore;
}

async function deployCafe(evvmCoreAddress: string, shopOwner: string) {
  const EVVMCafeGasless = await hre.ethers.getContractFactory("EVVMCafeGasless");
  const cafe = await EVVMCafeGasless.deploy(evvmCoreAddress, shopOwner);
  return cafe;
}

// ============ Test Helpers ============

/**
 * Creates mock encrypted data for testing
 */
async function createEncryptedAmount(
  evvmCoreAddress: string,
  cafeAddress: string,
  amount: bigint
): Promise<{ handle: string; proof: string }> {
  // For testing, we create a mock handle and proof
  // In production, this comes from the FHE SDK
  const handle = solidityPackedKeccak256(
    ["address", "address", "uint256", "uint256"],
    [evvmCoreAddress, cafeAddress, amount, Date.now()]
  );

  // Mock proof - in production this is a ZK proof from the FHE network
  const proof = "0x01" + handle.slice(2) + "0".repeat(128);

  return { handle, proof };
}

/**
 * Creates an amount commitment (keccak256 of the handle)
 */
function createAmountCommitment(handle: string): string {
  return keccak256(handle);
}

/**
 * Builds the EIP-191 message for signing
 */
function buildOrderMessage(params: {
  serviceId: number;
  client: string;
  coffeeType: string;
  quantity: bigint;
  serviceNonce: bigint;
  amountCommitment: string;
  evvmNonce: bigint;
  deadline: bigint;
  priorityFee: bigint;
}): string {
  return [
    params.serviceId.toString(),
    "orderCoffee",
    params.client.toLowerCase(),
    params.coffeeType,
    params.quantity.toString(),
    params.serviceNonce.toString(),
    params.amountCommitment.toLowerCase(),
    params.evvmNonce.toString(),
    params.deadline.toString(),
    params.priorityFee.toString(),
  ].join(",");
}

/**
 * Signs a message using EIP-191 (personal sign)
 */
async function signEIP191Message(
  signer: HardhatEthersSigner,
  message: string
): Promise<string> {
  // EIP-191: signMessage automatically prefixes with "\x19Ethereum Signed Message:\n" + len
  return signer.signMessage(message);
}

// ============ Tests ============

describe("EVVMCafeGasless - Gasless Coffee Orders (EIP-191)", function () {
  let evvmCore: Awaited<ReturnType<typeof deployEVVMCore>>;
  let cafe: Awaited<ReturnType<typeof deployCafe>>;
  let owner: HardhatEthersSigner;
  let shopOwner: HardhatEthersSigner;
  let client: HardhatEthersSigner;
  let fisher: HardhatEthersSigner;
  let otherUser: HardhatEthersSigner;

  const CAFE_SERVICE_ID = 1;
  const INITIAL_BALANCE = 1000n;

  beforeEach(async function () {
    [owner, shopOwner, client, fisher, otherUser] = await hre.ethers.getSigners();

    // Log network info
    const network = await hre.ethers.provider.getNetwork();
    console.log(`Running on ${network.name === "hardhat" ? "Hardhat" : network.name} with MOCK FHE`);
    console.log(`fhevm.isMock: true`);

    // Deploy contracts
    evvmCore = await deployEVVMCore();
    const evvmCoreAddress = await evvmCore.getAddress();

    cafe = await deployCafe(evvmCoreAddress, shopOwner.address);
    const cafeAddress = await cafe.getAddress();

    // Register client in EVVM
    const clientEncrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, INITIAL_BALANCE);
    await evvmCore.registerAccountFromAddress(
      client.address,
      clientEncrypted.handle,
      clientEncrypted.proof
    );

    // Register shop in EVVM
    const shopEncrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, 0n);
    await cafe.registerShopInEVVM(shopEncrypted.handle, shopEncrypted.proof);
  });

  describe("Deployment", function () {
    it("Should deploy with correct EVVM address", async function () {
      const evvmAddress = await cafe.evvm();
      expect(evvmAddress).to.equal(await evvmCore.getAddress());
    });

    it("Should set correct shop owner", async function () {
      const shopOwnerAddr = await cafe.ownerOfShop();
      expect(shopOwnerAddr).to.equal(shopOwner.address);
    });

    it("Should set correct service name", async function () {
      const name = await cafe.serviceName();
      expect(name).to.equal("EVVM Cafe");
    });

    it("Should set correct service ID", async function () {
      const id = await cafe.getServiceId();
      expect(id).to.equal(CAFE_SERVICE_ID);
    });

    it("Should initialize coffee prices", async function () {
      expect(await cafe.getCoffeePrice("espresso")).to.equal(2n);
      expect(await cafe.getCoffeePrice("latte")).to.equal(4n);
      expect(await cafe.getCoffeePrice("cappuccino")).to.equal(4n);
      expect(await cafe.getCoffeePrice("americano")).to.equal(3n);
    });
  });

  describe("Shop Registration", function () {
    it("Should allow registering the shop", async function () {
      const isRegistered = await cafe.isShopRegistered();
      expect(isRegistered).to.be.true;
    });
  });

  describe("EIP-191 Signature Validation", function () {
    it("Should generate valid EIP-191 signature that can be verified", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      // Create order parameters
      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 2n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce: 1n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      console.log("Message to sign:", message);

      const signature = await signEIP191Message(client, message);

      expect(signature).to.be.a("string");
      expect(signature.startsWith("0x")).to.be.true;
      expect(signature.length).to.equal(132); // 65 bytes = 130 hex chars + 0x
    });

    it("Should produce different signatures for different signers", async function () {
      const message = "1,orderCoffee,0x123...,espresso,1,1,0x456...,0,9999999999,1";

      const sig1 = await signEIP191Message(client, message);
      const sig2 = await signEIP191Message(otherUser, message);

      expect(sig1).to.not.equal(sig2);
    });

    it("Should accept valid EIP-191 signature", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 1n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce: 1n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      const signature = await signEIP191Message(client, message);

      // Execute order - should not revert
      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          quantity,
          1n,
          amountCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.not.be.reverted;
    });

    it("Should reject signature from wrong signer", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 1n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce: 2n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      // Sign with wrong account (otherUser instead of client)
      const signature = await signEIP191Message(otherUser, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          quantity,
          2n,
          amountCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "InvalidSignature");
    });

    it("Should reject expired signature", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 1n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);

      // Set deadline in the past
      const deadline = BigInt(Math.floor(Date.now() / 1000) - 100);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce: 3n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      const signature = await signEIP191Message(client, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          quantity,
          3n,
          amountCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "SignatureExpired");
    });

    it("Should reject mismatched amount commitment", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 1n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const wrongCommitment = keccak256(toUtf8Bytes("wrong")); // Wrong commitment
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce: 4n,
        amountCommitment: wrongCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      const signature = await signEIP191Message(client, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          quantity,
          4n,
          wrongCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "AmountCommitmentMismatch");
    });
  });

  describe("Service Nonce Management", function () {
    it("Should report nonces as unused initially", async function () {
      const isUsed = await cafe.isServiceNonceUsed(client.address, 100n);
      expect(isUsed).to.be.false;
    });

    it("Should reject reused service nonce", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("espresso");
      const quantity = 1n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const serviceNonce = 10n;

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity,
        serviceNonce,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      const signature = await signEIP191Message(client, message);

      // First call should succeed
      await cafe.connect(fisher).orderCoffeeGasless(
        client.address,
        "espresso",
        quantity,
        serviceNonce,
        amountCommitment,
        0n,
        deadline,
        priorityFee,
        encrypted.handle,
        encrypted.proof,
        signature
      );

      // Second call with same nonce should fail
      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          quantity,
          serviceNonce,
          amountCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "ServiceNonceAlreadyUsed");
    });
  });

  describe("Order Validation", function () {
    it("Should reject zero quantity", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, 1n);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "espresso",
        quantity: 0n, // Invalid
        serviceNonce: 20n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee: 1n,
      });

      const signature = await signEIP191Message(client, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "espresso",
          0n,
          20n,
          amountCommitment,
          0n,
          deadline,
          1n,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "InvalidQuantity");
    });

    it("Should reject invalid coffee type", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, 5n);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "unknown_coffee", // Invalid
        quantity: 1n,
        serviceNonce: 21n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee: 1n,
      });

      const signature = await signEIP191Message(client, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "unknown_coffee",
          1n,
          21n,
          amountCommitment,
          0n,
          deadline,
          1n,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      ).to.be.revertedWithCustomError(cafe, "InvalidCoffeeType");
    });
  });

  describe("Event Emissions", function () {
    it("Should emit GaslessCoffeeOrdered with correct parameters", async function () {
      const evvmCoreAddress = await evvmCore.getAddress();
      const cafeAddress = await cafe.getAddress();

      const coffeePrice = await cafe.getCoffeePrice("latte");
      const quantity = 2n;
      const priorityFee = 1n;
      const totalPrice = coffeePrice * quantity + priorityFee;

      const encrypted = await createEncryptedAmount(evvmCoreAddress, cafeAddress, totalPrice);
      const amountCommitment = createAmountCommitment(encrypted.handle);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const message = buildOrderMessage({
        serviceId: CAFE_SERVICE_ID,
        client: client.address,
        coffeeType: "latte",
        quantity,
        serviceNonce: 30n,
        amountCommitment,
        evvmNonce: 0n,
        deadline,
        priorityFee,
      });

      const signature = await signEIP191Message(client, message);

      await expect(
        cafe.connect(fisher).orderCoffeeGasless(
          client.address,
          "latte",
          quantity,
          30n,
          amountCommitment,
          0n,
          deadline,
          priorityFee,
          encrypted.handle,
          encrypted.proof,
          signature
        )
      )
        .to.emit(cafe, "GaslessCoffeeOrdered")
        .withArgs(
          client.address,
          "latte",
          quantity,
          0n, // evvmNonce
          fisher.address,
          priorityFee
        );
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set coffee price", async function () {
      await cafe.connect(owner).setCoffeePrice("mocha", 5n);
      expect(await cafe.getCoffeePrice("mocha")).to.equal(5n);
    });

    it("Should reject non-owner setting coffee price", async function () {
      await expect(
        cafe.connect(client).setCoffeePrice("mocha", 5n)
      ).to.be.revertedWithCustomError(cafe, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to update shop owner", async function () {
      await cafe.connect(owner).setShopOwner(otherUser.address);
      expect(await cafe.ownerOfShop()).to.equal(otherUser.address);
    });
  });
});
