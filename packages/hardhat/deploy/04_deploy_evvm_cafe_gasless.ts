import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Deploys EVVMCafeGasless contract - gasless coffee shop with EIP-712 signatures
 *
 * @param hre HardhatRuntimeEnvironment object.
 */
const deployEVVMCafeGasless: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Get the deployed EVVMCore contract address
  const evvmCore = await hre.ethers.getContract<Contract>("EVVMCore", deployer);
  const evvmCoreAddress = await evvmCore.getAddress();

  // Owner of the shop (using deployer for simplicity, can be changed)
  const ownerOfShop = deployer;

  await deploy("EVVMCafeGasless", {
    from: deployer,
    // Contract constructor arguments
    args: [evvmCoreAddress, ownerOfShop],
    log: true,
    // autoMine: can be passed to the deploy function to make the deployment process faster on local networks by
    // automatically mining the contract deployment transaction. There is no effect on live networks.
    autoMine: true,
  });

  // Get the deployed contract to interact with it after deploying.
  const evvmCafeGasless = await hre.ethers.getContract<Contract>("EVVMCafeGasless", deployer);
  console.log("EVVMCafeGasless deployed at:", evvmCafeGasless.target);
  console.log("  - EVVMCore address:", await evvmCafeGasless.evvm());
  console.log("  - Shop owner:", await evvmCafeGasless.ownerOfShop());
  console.log("  - Contract owner:", await evvmCafeGasless.owner());
  console.log("  - Service name:", await evvmCafeGasless.serviceName());
  console.log("");
  console.log("Gasless features:");
  console.log("  - EIP-712 domain separator configured");
  console.log("  - Users sign off-chain (no gas)");
  console.log("  - Fishers execute on-chain (pay gas, earn rewards)");
};

export default deployEVVMCafeGasless;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags EVVMCafeGasless
deployEVVMCafeGasless.tags = ["EVVMCafeGasless"];

// This deploy function depends on EVVMCore being deployed first
deployEVVMCafeGasless.dependencies = ["EVVMCore"];
