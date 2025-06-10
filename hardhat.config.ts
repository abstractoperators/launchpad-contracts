import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-ignition-ethers";
const { vars }  = require("hardhat/config");
const PRIVATE_KEY = vars.get("PRIVATE_KEY");

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
    local_testnet: {
      url: "http://127.0.0.1:8545",
      chainId: 31337, // This is the ChainID for forked atlantic-2
    },
    // Documentation on deploying to a live network 
    // https://hardhat.org/tutorial/deploying-to-a-live-network 
    real_testnet: {
      url: "https://evm-rpc-testnet.sei-apis.com",
      chainId: 1328,
      accounts: [PRIVATE_KEY],
    }
  }
}


export default config;
