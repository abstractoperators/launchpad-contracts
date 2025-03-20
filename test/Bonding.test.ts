import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, Signer } from "ethers";
import { bigint } from "hardhat/internal/core/params/argumentTypes";

describe("Bonding Contract", function () {
    let owner: Signer, user: Signer, feeRecipient: Signer;
    let Bonding: Contract, Factory: Contract, Router: Contract, AssetToken: Contract;

    before(async function () {
        [owner, user, feeRecipient] = await ethers.getSigners();

        // Deploy a mock ERC20 token to act as the assetToken
        const MockERC20 = await ethers.getContractFactory("FERC20");
        AssetToken = await MockERC20.connect(owner).deploy("Asset Token", "AST", ethers.parseEther("1000000"), ethers.parseEther("1000"));
        await AssetToken.waitForDeployment();

        // Deploy Factory contract
        const FFactory = await ethers.getContractFactory("FFactory");
        Factory = await upgrades.deployProxy(FFactory, [await feeRecipient.getAddress(), 5, 5], { initializer: "initialize" });
        await Factory.waitForDeployment();

        // Deploy Router contract
        const FRouter = await ethers.getContractFactory("FRouter");
        Router = await upgrades.deployProxy(FRouter, [Factory.target, AssetToken.target], { initializer: "initialize" });
        await Router.waitForDeployment();

        // Define Roles
        const CREATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CREATOR_ROLE"));
        const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
        const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

        // Grant necessary roles
        await Factory.connect(owner).grantRole(ADMIN_ROLE, await owner.getAddress());
        await Factory.connect(owner).grantRole(CREATOR_ROLE, await owner.getAddress());
        await Router.connect(owner).grantRole(EXECUTOR_ROLE, await owner.getAddress());

        // Set Router in Factory
        await Factory.connect(owner).setRouter(Router.target);

        // Deploy Bonding contract using upgradeable proxy pattern
        const BondingFactory = await ethers.getContractFactory("Bonding");
        Bonding = await upgrades.deployProxy(BondingFactory, [], { initializer: false });
        await Bonding.waitForDeployment();

        // Initialize Bonding contract
        await Bonding.initialize(
            Factory.target,   // factory address
            Router.target,    // router address
            await feeRecipient.getAddress(), // fee recipient
            50,               // fee percentage (e.g., 5%)
            100000, // initial supply
            1000,             // assetRate
            ethers.parseEther("1000"), // max transaction
            ethers.ZeroAddress,  // agent factory (optional)
            ethers.parseEther("5000") // grad threshold
        );

        await Factory.connect(owner).grantRole(CREATOR_ROLE, Bonding.target);
        await Router.connect(owner).grantRole(EXECUTOR_ROLE, Bonding.target);
    });

    it("should initialize correctly", async function () {
        expect(await Bonding.factory()).to.equal(Factory.target);
        expect(await Bonding.router()).to.equal(Router.target);
        expect(await Bonding.fee()).to.equal(ethers.parseEther("50") / BigInt(1000)); // Converted to 5% in wei
    });

    it("should allow owner to set initial supply", async function () {
        await Bonding.setInitialSupply("500000");
        expect(await Bonding.initialSupply()).to.equal("500000");
    });

    it("should create a trading pair", async function () {
        // Create a test ERC20 token
        const TestToken = await ethers.getContractFactory("FERC20");
        const testToken = await TestToken.deploy("Test Token", "TST", ethers.parseEther("1000000"), ethers.parseEther("10000"));
        await testToken.waitForDeployment();

        // Grant CREATOR_ROLE to the test deployer
        const CREATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CREATOR_ROLE"));
        await Factory.connect(owner).grantRole(CREATOR_ROLE, await owner.getAddress());

        // Create pair
        await expect(Factory.connect(owner).createPair(testToken.target, AssetToken.target))
            .to.emit(Factory, "PairCreated");

        const pairAddress = await Factory.getPair(testToken.target, AssetToken.target);
        expect(pairAddress).to.properAddress;
    });

    it("should allow user to launch a token", async function () {
        // Send some token from owner to user
        const transferResult = await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("100"))
        await transferResult.wait()

        // User approves Bonding contract to spend AssetToken
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("100"));

        // Launch a token
        const tx = await Bonding.connect(user).launch(
            "Test Token",
            "TST",
            [1, 2, 3], // Cores (dummy data)
            "A test token for bonding",
            "ipfs://image",
            ["twitter.com", "telegram.com", "youtube.com", "website.com"],
            ethers.parseEther("100") // Purchase amount
        );

        const receipt = await tx.wait();

        const filter = Bonding.filters.Launched();
        const events = await Bonding.queryFilter(filter, "latest");

        expect(events.length).to.be.greaterThan(0);
        expect(events[0].args.token).to.be.properAddress;
        expect(events[0].args.pair).to.be.properAddress;
    });

    it("should allow a user to buy and sell tokens", async function () {
        const tokenAddress = (await Bonding.tokenInfos(0)) as string;
        expect(tokenAddress).to.be.properAddress;

        const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);

        // Send user some asset tokens so they can make transfers
        await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("100"))

        // Approve token transfer. Need to approve the Router instead of the Bonding.sol contract since the router performs the swap
        await AssetToken.connect(user).approve(Router.target, ethers.parseEther("50"));
        
        // Buy token
        await Bonding.connect(user).buy(ethers.parseEther("50"), tokenAddress);
        const newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.gt(0);

        // Sell token
        // Approve token transfer. Need to approve the Router instead of the Bonding.sol contract since the router performs the swap
        await tokenContract.connect(user).approve(Router.target, ethers.parseEther("20"));
        await Bonding.connect(user).sell(newTokenBal / BigInt(2), tokenAddress);
    });
});
