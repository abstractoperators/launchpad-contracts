import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { network } from "hardhat";
import { getLaunchedEvent } from "../test/utils";
async function main() {
    const [deployer] = await ethers.getSigners();
    const owner = deployer;

    const Bonding = await ethers.getContractAt("Bonding", "0xDdFF841E7bb9c2180D160eE5E11663ca127Fd21e");


    const launchFee = await Bonding.assetLaunchFee();

    const launchTx = await Bonding.connect(owner).launchWithSei(
        "this is my token launched with sei",
        "t1",
        {
            value: launchFee
        }
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