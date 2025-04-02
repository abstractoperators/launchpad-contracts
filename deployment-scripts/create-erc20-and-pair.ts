import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { network } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    const owner = deployer;

    const Bonding = await ethers.getContractAt("Bonding", "0xfDcEb67aB320Fadd303D8AC682041f702bE7DfE2");
    const Factory = await ethers.getContractAt("FFactory", "0x52aBD4Cb4D3770c5c92b736aA169b4923867c6BB");
    const WSEI = await ethers.getContractAt("WSEI", "0xae7CC55D9cF3bd6CcC72dc113369d3e5a9085d32");

    const TestTokenFactory = await ethers.getContractFactory("FERC20");
    const TestToken = await TestTokenFactory.deploy("TestToken", "TT", ethers.parseEther("1000000"), ethers.parseEther("10000"));
    await TestToken.waitForDeployment();
    console.log("TestToken deployed to:", TestToken.target);

    // const CREATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CREATOR_ROLE"));
    // await Factory.connect(owner).grantRole(CREATER_ROLE, await owner.getAddress());
    await Factory.connect(owner).createPair(TestToken.target, WSEI.target);

    const pairAddress = await Factory.getPair(TestToken.target, WSEI.target);
    console.log("Pair created at:", pairAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });