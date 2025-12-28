/**
 * Setup script for EVVMCafeGasless
 *
 * This script checks and displays the shop registration status.
 * The shop needs to be registered via the frontend (which handles FHE encryption).
 *
 * Usage: yarn workspace @se-2/hardhat hardhat run scripts/setupEvvmCafeGasless.ts --network sepolia
 */
async function main() {
  const hre = await import("hardhat");

  // Get deployed contracts using deployments
  const evvmCafeGaslessDeployment = await hre.deployments.get("EVVMCafeGasless");
  const evvmCoreDeployment = await hre.deployments.get("EVVMCore");

  const evvmCafeGasless = await hre.ethers.getContractAt("EVVMCafeGasless", evvmCafeGaslessDeployment.address);
  const evvmCore = await hre.ethers.getContractAt("EVVMCore", evvmCoreDeployment.address);

  console.log("Checking EVVMCafeGasless setup...");
  console.log("EVVMCafeGasless address:", await evvmCafeGasless.getAddress());
  console.log("EVVMCore address:", await evvmCore.getAddress());

  // Check if shop is already registered
  const isRegistered = await evvmCafeGasless.isShopRegistered();

  if (isRegistered) {
    console.log("✅ Shop is already registered in EVVM");
  } else {
    console.log("⚠️  Shop is NOT registered in EVVM");
    console.log("   To register the shop:");
    console.log("   1. Go to http://localhost:3000/evvm-cafe-gasless");
    console.log("   2. Connect your wallet");
    console.log('   3. Click "Register Shop" button');
    console.log("   This will encrypt a zero balance and register the shop.");
  }

  // Display shop info
  console.log("\n📊 Shop Information:");
  console.log("  - Shop owner:", await evvmCafeGasless.ownerOfShop());
  console.log("  - Contract owner:", await evvmCafeGasless.owner());
  console.log("  - Service name:", await evvmCafeGasless.serviceName());
  console.log("  - Service ID:", await evvmCafeGasless.getServiceId());

  // Display coffee prices
  console.log("\n☕ Coffee Prices:");
  const coffeeTypes = ["espresso", "latte", "cappuccino", "americano"];
  for (const coffeeType of coffeeTypes) {
    try {
      const price = await evvmCafeGasless.getCoffeePrice(coffeeType);
      console.log(`  - ${coffeeType}: ${price} tokens`);
    } catch (_error: unknown) {
      // Ignore if price doesn't exist
    }
  }

  console.log("\n🔑 EIP-191 Message Format:");
  console.log("  {serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}");
  console.log("\n  Example:");
  console.log("  1,orderCoffee,0x1234...,espresso,1,1,0x5678...,0,1735689600,1");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
