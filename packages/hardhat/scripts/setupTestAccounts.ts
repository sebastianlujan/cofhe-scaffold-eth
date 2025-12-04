/**
 * @file setupTestAccounts.ts
 * @description Script to register test accounts for testing state commitment calculation
 *
 * Usage: yarn workspace @se-2/hardhat hardhat run scripts/setupTestAccounts.ts --network localhost
 */

import { Encryptable } from "@cofhe/sdk";

async function main() {
  const hre = await import("hardhat");
  const [deployer, alice, bob] = await hre.ethers.getSigners();

  // Get deployed contracts
  const evvmCoreDeployment = await hre.deployments.get("EVVMCore");
  const evvmCore = await hre.ethers.getContractAt("EVVMCore", evvmCoreDeployment.address, deployer);

  console.log("🔧 Setting up test accounts...");
  console.log(`EVVMCore address: ${evvmCoreDeployment.address}`);

  // Initialize CoFHE clients
  const deployerClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(deployer);
  const aliceClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(alice);
  const bobClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(bob);

  // Register deployer account
  console.log("\n📝 Registering deployer account...");
  const deployerEncryptResult = await deployerClient.encryptInputs([Encryptable.uint64(1000n)]).encrypt();
  const [deployerBalance] = await hre.cofhesdk.expectResultSuccess(deployerEncryptResult);
  await evvmCore.connect(deployer).registerAccountFromAddress(deployer.address, deployerBalance);
  console.log(`  ✓ Deployer registered with balance: 1000 tokens`);

  // Register Alice account
  console.log("\n📝 Registering Alice account...");
  const aliceEncryptResult = await aliceClient.encryptInputs([Encryptable.uint64(500n)]).encrypt();
  const [aliceBalance] = await hre.cofhesdk.expectResultSuccess(aliceEncryptResult);
  await evvmCore.connect(alice).registerAccountFromAddress(alice.address, aliceBalance);
  console.log(`  ✓ Alice registered with balance: 500 tokens`);

  // Register Bob account
  console.log("\n📝 Registering Bob account...");
  const bobEncryptResult = await bobClient.encryptInputs([Encryptable.uint64(250n)]).encrypt();
  const [bobBalance] = await hre.cofhesdk.expectResultSuccess(bobEncryptResult);
  await evvmCore.connect(bob).registerAccountFromAddress(bob.address, bobBalance);
  console.log(`  ✓ Bob registered with balance: 250 tokens`);

  console.log("\n✅ Test accounts setup complete!");
  console.log("   You can now run calculateStateCommitment.ts to see the state commitment");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
