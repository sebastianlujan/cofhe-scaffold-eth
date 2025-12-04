/**
 * @file calculateStateCommitment.ts
 * @description Script to calculate and optionally update state commitment on-chain
 *
 * Usage:
 *   yarn workspace @se-2/hardhat hardhat run scripts/calculateStateCommitment.ts --network localhost
 *
 * Options (via environment variables):
 *   EVVM_CORE_ADDRESS=<address>    EVVMCore contract address (default: from deployments)
 *   UPDATE_ON_CHAIN=true           Update the commitment on-chain after calculation
 *   USE_SIMPLE_HASH=true           Use simple hash instead of Merkle tree
 *   ONLY_ADDRESS_BASED=true        Only include accounts registered from addresses
 *
 * Example:
 *   UPDATE_ON_CHAIN=true yarn workspace @se-2/hardhat hardhat run scripts/calculateStateCommitment.ts --network localhost
 */

import { calculateStateCommitment, StateCommitmentOptions } from "../utils/stateCommitment";

async function main() {
  const hre: any = require("hardhat");
  const [signer] = await hre.ethers.getSigners();

  // Parse command line arguments and environment variables
  // Note: Hardhat intercepts --flags, so we use environment variables as alternative
  // You can also pass arguments after the script name: node scripts/calculateStateCommitment.ts --update-on-chain
  const scriptArgs = process.argv.slice(process.argv.indexOf("calculateStateCommitment.ts") + 1);

  let evvmCoreAddress: string | null = null;
  const updateOnChain = process.env.UPDATE_ON_CHAIN === "true" || scriptArgs.includes("--update-on-chain");
  const useSimpleHash = process.env.USE_SIMPLE_HASH === "true" || scriptArgs.includes("--use-simple-hash");
  const onlyAddressBased = process.env.ONLY_ADDRESS_BASED === "true" || scriptArgs.includes("--only-address-based");

  // Parse address from args or env
  const addressIndex = scriptArgs.indexOf("--evvm-core-address");
  if (addressIndex !== -1 && scriptArgs[addressIndex + 1]) {
    evvmCoreAddress = scriptArgs[addressIndex + 1];
  } else if (process.env.EVVM_CORE_ADDRESS) {
    evvmCoreAddress = process.env.EVVM_CORE_ADDRESS;
  }

  // Get EVVMCore contract address
  if (!evvmCoreAddress) {
    try {
      const deployment = await hre.deployments.get("EVVMCore");
      evvmCoreAddress = deployment.address;
      console.log(`📋 Using EVVMCore from deployments: ${evvmCoreAddress}`);
    } catch (_error: unknown) {
      console.error(_error);
      console.error("❌ EVVMCore not found in deployments. Please provide --evvm-core-address");
      process.exit(1);
    }
  }

  // Get contract instance
  const evvmCore = await hre.ethers.getContractAt("EVVMCore", evvmCoreAddress, signer);

  // Initialize CoFHE client
  console.log("🔐 Initializing CoFHE client...");
  const cofheClient = await hre.cofhesdk.createBatteriesIncludedCofhesdkClient(signer);
  console.log("  ✓ CoFHE client initialized");

  // Calculate state commitment
  const options: StateCommitmentOptions = {
    evvmCore,
    cofheClient,
    onlyAddressBased,
  };

  const commitment = await calculateStateCommitment(options, !useSimpleHash);

  // Update on-chain if requested
  if (updateOnChain) {
    console.log("\n📝 Updating state commitment on-chain...");
    try {
      const tx = await evvmCore.updateStateCommitment(commitment);
      console.log(`  → Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log("  ✓ State commitment updated on-chain");
    } catch (error) {
      console.error("  ❌ Failed to update state commitment:", error);
      process.exit(1);
    }
  } else {
    console.log("\n💡 Tip: Use --update-on-chain to update the commitment on-chain");
  }

  console.log("\n✅ State commitment calculation complete!");
  console.log(`   Commitment: ${commitment}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
