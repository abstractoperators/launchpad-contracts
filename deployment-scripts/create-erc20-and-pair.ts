import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { network } from "hardhat";
import { getLaunchedEvent } from "../test/utils";
async function main() {
    const [deployer] = await ethers.getSigners();
    const owner = deployer;

    const Bonding = await ethers.getContractAt("Bonding", "0x202CCe504e04bEd6fC0521238dDf04Bc9E8E15aB");
    // const Factory = await ethers.getContractAt("FFactory", "0x52aBD4Cb4D3770c5c92b736aA169b4923867c6BB");
    // const WSEI = await ethers.getContractAt("WSEI", "0xae7CC55D9cF3bd6CcC72dc113369d3e5a9085d32");

    // const TestTokenFactory = await ethers.getContractFactory("FERC20");
    // const TestToken = await TestTokenFactory.deploy("TestToken", "TT", ethers.parseEther("1000000"), ethers.parseEther("10000"));
    // await TestToken.waitForDeployment();
    // console.log("TestToken deployed to:", TestToken.target);

    
    // console.log("Creating pair for token:", TestToken.target, "and WSEI:", WSEI.target);
    // await Factory.connect(owner).createPair(TestToken.target, WSEI.target);

    // const pairAddress = await Factory.getPair(TestToken.target, WSEI.target);
    // console.log("Pair created at:", pairAddress);

    const launchFee = await Bonding.assetLaunchFee();
    // // Make sure the 'user' has enough WSEI to pay for the launch fee by transferring WSEI to the user
    // const transferResult = await WSEI.connect(owner).transfer(await user.getAddress(), launchFee)
    // await transferResult.wait()

    // await WSEI.connect(owner).approve(Bonding.target, launchFee);
    const launchTx = await Bonding.connect(owner).launchWithSei(
        "this is my token launched with sei",
        "t1",
        {
            value: launchFee
        }
        // WSEI.target
    );
    const user = owner;
    const launchReceipt = await launchTx.wait();
    console.log("Launch transaction hash:", launchTx.hash);

    const launchEvent = getLaunchedEvent(launchReceipt);
    const tokenAddress = (await Bonding.tokenInfo(launchEvent.args.token)).token as string;
    console.log("Token launched at:", tokenAddress);
    const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);
    const userAddress = await owner.getAddress();
    const startSEIBalance = await ethers.provider.getBalance(userAddress);
    const startTokenBalance = await tokenContract.balanceOf(userAddress);
    console.log("User SEI balance before:", startSEIBalance.toString());
    console.log("User token balance before:", startTokenBalance.toString());
    const buyTx = await Bonding.connect(user).buyWithSei(tokenAddress, {
        value: ethers.parseEther("0.01"),
        });
    const buyReceipt = await buyTx.wait();

    const endSEIBalance = await ethers.provider.getBalance(userAddress);
    const endTokenBalance = await tokenContract.balanceOf(userAddress);
    console.log("User SEI balance after buy:", endSEIBalance.toString());
    console.log("User token balance after buy:", endTokenBalance.toString());


}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });