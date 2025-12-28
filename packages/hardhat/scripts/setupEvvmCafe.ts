/**
 * Setup script for EVVMCafe
 *
 * This script registers the shop in EVVM Core after deployment.
 * Note: In a real scenario, you would need to encrypt a zero balance
 * using the CoFHE SDK. For local testing, this can be done via the frontend
 * or a separate setup script with CoFHE SDK integration.
 *
 * Usage: yarn workspace @se-2/hardhat hardhat run scripts/setupEvvmCafe.ts --network localhost
 */
async function main() {
  const hre = await import("hardhat");

  // Get deployed contracts using deployments
  const evvmCafeDeployment = await hre.deployments.get("EVVMCafe");
  const evvmCoreDeployment = await hre.deployments.get("EVVMCore");

  const evvmCafe = await hre.ethers.getContractAt("EVVMCafe", evvmCafeDeployment.address);
  const evvmCore = await hre.ethers.getContractAt("EVVMCore", evvmCoreDeployment.address);

  console.log("Setting up EVVMCafe...");
  console.log("EVVMCafe address:", await evvmCafe.getAddress());
  console.log("EVVMCore address:", await evvmCore.getAddress());

  // Check if shop is already registered
  const isRegistered = await evvmCafe.isShopRegistered();

  if (isRegistered) {
    console.log("✅ Shop is already registered in EVVM");
  } else {
    console.log("⚠️  Shop is not registered in EVVM");
    console.log("   To register the shop, you need to:");
    console.log("   1. Encrypt a zero balance using CoFHE SDK");
    console.log("   2. Call evvmCafe.registerShopInEVVM(encryptedZeroBalance)");
    console.log("   Or use the frontend to register the shop.");
  }

  // Display shop info
  console.log("\n📊 Shop Information:");
  console.log("  - Shop owner:", await evvmCafe.ownerOfShop());
  console.log("  - Contract owner:", await evvmCafe.owner());

  // Display coffee prices
  console.log("\n☕ Coffee Prices:");
  const coffeeTypes = ["espresso", "latte", "cappuccino", "americano"];
  for (const coffeeType of coffeeTypes) {
    try {
      const price = await evvmCafe.getCoffeePrice(coffeeType);
      console.log(`  - ${coffeeType}: ${price} tokens`);
    } catch (_error: unknown) {
      console.error(_error);
      // Ignore if price doesn't exist
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
