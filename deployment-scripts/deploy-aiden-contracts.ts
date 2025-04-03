import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { network } from "hardhat";

type DragonSwapAddresses = {
    factory: string;
    router: string;
};


const dragonSwapContracts: Record<string, DragonSwapAddresses> = {
    "local_testnet": {
        factory: "0xeE6Ad607238f8d2C63767245d78520F06c303D31",
        router: "0x527b42CA5e11370259EcaE68561C14dA415477C8",
    },
    "real_testnet": {
        factory: "0xeE6Ad607238f8d2C63767245d78520F06c303D31",
        router: "0x527b42CA5e11370259EcaE68561C14dA415477C8",
    },
};

async function main() {
    const [deployer] = await ethers.getSigners();
    const feeRecipient = deployer;
    const owner = deployer;
    console.log("Deploying contracts with the account:", deployer.address);

    const WSEIContract = await ethers.getContractFactory("WSEI");
    const WSEI = await WSEIContract.connect(deployer).deploy();
    await WSEI.waitForDeployment();

    console.log("WSEI deployed to:", WSEI.target);

    const FFactory = await ethers.getContractFactory("FFactory");
    const multiplier = 1;
    const Factory = await upgrades.deployProxy(FFactory, [await feeRecipient.getAddress(), 5, 5, multiplier], {initializer: "initialize"});
    await Factory.waitForDeployment();
    
    console.log("Factory deployed to:", Factory.target);


    const FRouter = await ethers.getContractFactory("FRouter");
    const Router = await upgrades.deployProxy(FRouter, [Factory.target], {initializer: "initialize"});
    await Router.waitForDeployment();
    console.log("Router deployed to:", Router.target);

    const SyntheticPair = await ethers.getContractFactory("SyntheticPair");
    // const PairAbi = SyntheticPair.interface;

    // const DragonswapRouter = await ethers.getContractAt("IDragonswapRouter", dragonSwapContracts[network.name].router);
    // const DragonswapFactory = await ethers.getContractAt("IDragonswapFactory", dragonSwapContracts[network.name].factory);


    const CREATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CREATOR_ROLE"));
    const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
    const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

    await Factory.connect(owner).grantRole(ADMIN_ROLE, await owner.getAddress());
    await Factory.connect(owner).grantRole(CREATOR_ROLE, await owner.getAddress());
    await Factory.connect(owner).grantRole(EXECUTOR_ROLE, await owner.getAddress());

    await Factory.connect(owner).setRouter(Router.target);

    const BondingFactory = await ethers.getContractFactory("Bonding");
    const Bonding = await upgrades.deployProxy(BondingFactory, [], { initializer: false });
    await Bonding.waitForDeployment();
    console.log("Bonding deployed to:", Bonding.target);

    const initialSupply = ethers.parseEther("100000"); 
    const gradTheshold = ethers.parseEther("25000");
    // const launchFee = ethers.parseEther("100"); // 100 AIDEN asset
    const launchFee = ethers.parseEther("0.1");
    const maxTx = 20;

    await Bonding.initialize(
        Factory.target,
        Router.target,
        WSEI.target,
        launchFee, // asset token
        launchFee, // wsei
        initialSupply, 
        maxTx, // max percent of each token purchasable in one tx
        gradTheshold, // sei grad threshold
        gradTheshold, // asset grad threshold
        100, // dragonswap pool bps
        dragonSwapContracts[network.name].factory,
        dragonSwapContracts[network.name].router
    );
    console.log("Bonding initialized");

    await Factory.connect(owner).grantRole(CREATOR_ROLE, await Bonding.target);
    await Router.connect(owner).grantRole(EXECUTOR_ROLE, await Bonding.target);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });