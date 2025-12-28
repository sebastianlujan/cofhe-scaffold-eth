/**
 * Register EVVMCafeGasless shop in EVVM Core
 *
 * This script registers the gasless coffee shop in EVVM with an encrypted zero initial balance.
 * Uses Zama's FHEVM SDK via hardhat plugin to create the encrypted input.
 *
 * Usage: npx hardhat run scripts/registerGaslessShop.ts --network sepolia
 */
import { ethers, fhevm } from "hardhat";

async function main() {
  console.log("=".repeat(60));
  console.log("Registering EVVMCafeGasless Shop in EVVM");
  console.log("=".repeat(60));

  // Initialize FHEVM CLI API - required for scripts (tests auto-initialize)
  console.log("\nInitializing FHEVM...");
  await fhevm.initializeCLIApi();

  // Get signer
  const [deployer] = await ethers.getSigners();
  console.log("\nDeployer address:", deployer.address);

  // Get deployed contracts
  const evvmCafeGaslessDeployment = await import("../deployments/sepolia/EVVMCafeGasless.json");
  const evvmCoreDeployment = await import("../deployments/sepolia/EVVMCore.json");

  const evvmCafeGasless = await ethers.getContractAt(
    "EVVMCafeGasless",
    evvmCafeGaslessDeployment.address
  );
  const evvmCore = await ethers.getContractAt("EVVMCore", evvmCoreDeployment.address);

  const shopAddress = await evvmCafeGasless.getAddress();
  const evvmCoreAddress = await evvmCore.getAddress();

  console.log("\nContracts:");
  console.log("  EVVMCafeGasless:", shopAddress);
  console.log("  EVVMCore:", evvmCoreAddress);

  // Check if shop is already registered
  const isRegistered = await evvmCafeGasless.isShopRegistered();

  if (isRegistered) {
    console.log("\n✅ Shop is already registered in EVVM!");
    
    // Get shop vaddr
    const shopVaddr = await evvmCore.getVaddrFromAddress(shopAddress);
    console.log("  Shop vaddr:", shopVaddr);
    
    // Get shop nonce
    const shopNonce = await evvmCore.getNonce(shopVaddr);
    console.log("  Shop nonce:", shopNonce.toString());
    
    return;
  }

  console.log("\n⏳ Shop not registered. Registering now...");

  // Debug info
  const existingVaddr = await evvmCore.getVaddrFromAddress(shopAddress);
  const generatedVaddr = await evvmCore.generateVaddrFromAddress(shopAddress, ethers.ZeroHash);
  const generatedExists = await evvmCore.accountExists(generatedVaddr);
  
  console.log("\n  Debug info:");
  console.log("    Shop address:", shopAddress);
  console.log("    Existing vaddr (from mapping):", existingVaddr);
  console.log("    Generated vaddr:", generatedVaddr);
  console.log("    Generated vaddr account exists:", generatedExists);

  // Create encrypted zero balance using fhevm hardhat plugin
  // The encrypted input must be created with the EVVMCore address (the contract that will use it)
  console.log("\n1. Creating encrypted zero balance...");
  
  const encrypted = await fhevm
    .createEncryptedInput(evvmCoreAddress, deployer.address)
    .add64(0n)
    .encrypt();

  const encryptedHandle = encrypted.handles[0];
  const inputProof = encrypted.inputProof;

  console.log("  Encrypted handle:", ethers.hexlify(encryptedHandle).slice(0, 20) + "...");
  console.log("  Input proof length:", inputProof.length);

  // Register shop directly via EVVMCore.registerAccountFromAddress
  // This avoids any potential issues with the EVVMCafeGasless wrapper
  console.log("\n2. Calling EVVMCore.registerAccountFromAddress...");
  
  const tx = await evvmCore.registerAccountFromAddress(
    shopAddress,
    encryptedHandle,
    inputProof
  );
  console.log("  Transaction hash:", tx.hash);
  
  console.log("\n3. Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log("  Block number:", receipt?.blockNumber);
  console.log("  Gas used:", receipt?.gasUsed.toString());

  // Verify registration
  console.log("\n4. Verifying registration...");
  const isNowRegistered = await evvmCafeGasless.isShopRegistered();
  
  if (isNowRegistered) {
    console.log("\n✅ Shop successfully registered!");
    
    // Get shop vaddr
    const shopVaddr = await evvmCore.getVaddrFromAddress(shopAddress);
    console.log("  Shop vaddr:", shopVaddr);
    
    // Get shop nonce
    const shopNonce = await evvmCore.getNonce(shopVaddr);
    console.log("  Shop nonce:", shopNonce.toString());
  } else {
    console.log("\n❌ Registration verification failed!");
    console.log("  (But transaction succeeded, check contract state manually)");
  }

  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
