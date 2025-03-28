import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true // Enables the Intermediate Representation optimizer
    }
  },
  networks: {
    testnet: {
      url: "http://127.0.0.1:8545",
      chainId: 31337, // This is the ChainID for forked atlantic-2
    },
  }
};

export default config;
