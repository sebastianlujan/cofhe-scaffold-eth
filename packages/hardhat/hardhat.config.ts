import * as dotenv from "dotenv";
dotenv.config();
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import "@nomicfoundation/hardhat-toolbox";
// FHEVM Hardhat Plugin - provides fhevm global for tests
// Modes: hardhat (mock), localhost (mock+persistent), sepolia (real encryption)
import "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import generateTsAbis from "./scripts/generateTsAbis";

// If not set, it uses the hardhat account 0 private key.
// You can generate a random account with `yarn generate` or `yarn account:import` to import your existing PK
const deployerPrivateKey =
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// If not set, it uses our block explorers default API keys.
const etherscanApiKey = process.env.ETHERSCAN_MAINNET_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const etherscanOptimisticApiKey = process.env.ETHERSCAN_OPTIMISTIC_API_KEY || "RM62RDISS1RH448ZY379NX625ASG1N633R";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const basescanApiKey = process.env.BASESCAN_API_KEY || "ZZZEIPMT1MNJ8526VV2Y744CA7TNZR64G6";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        // For Multicall3.sol and other contracts that require 0.8.25+
        version: "0.8.25",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "localhost",
  namedAccounts: {
    deployer: {
      // By default, it will take the first Hardhat account as the deployer
      default: 0,
    },
  },
  networks: {
    // ============ FHEVM Runtime Modes ============
    // 1. Hardhat (In-Memory): Mock encryption, fast tests
    // 2. Hardhat Node (localhost): Mock encryption, persistent state
    // 3. Sepolia Testnet: Real encryption, production-like

    hardhat: {
      forking: {
        url: `https://eth.llamarpc.com`,
        enabled: process.env.MAINNET_FORKING_ENABLED === "true",
      },
      mining: {
        auto: true,
        interval: 2000,
      },
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // Sepolia with Zama FHEVM (Real Encryption)
    sepolia: {
      url: `https://ethereum-sepolia-rpc.publicnode.com`,
      accounts: [deployerPrivateKey],
      chainId: 11155111,
    },
    mainnet: {
      url: `https://eth.llamarpc.com`,
      accounts: [deployerPrivateKey],
    },
  },
  // Configuration for hardhat-verify plugin
  etherscan: {
    apiKey: `${etherscanApiKey}`,
  },
  // Configuration for etherscan-verify from hardhat-deploy plugin
  verify: {
    etherscan: {
      apiKey: `${etherscanApiKey}`,
    },
  },
  sourcify: {
    enabled: false,
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS === "true",
    excludeContracts: [],
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  // Mocha test configuration
  mocha: {
    timeout: 120000, // 2 minutes for FHE operations on hardhat
  },
};

// Task to list accounts
task("accounts", "Prints the list of accounts").setAction(async (_, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    const balance = await hre.ethers.provider.getBalance(account.address);
    console.log(`${account.address} - ${hre.ethers.formatEther(balance)} ETH`);
  }
});

// Extend the deploy task
task("deploy").setAction(async (args, hre, runSuper) => {
  // Run the original deploy task
  await runSuper(args);
  // Force run the generateTsAbis script
  await generateTsAbis(hre);
});

export default config;
