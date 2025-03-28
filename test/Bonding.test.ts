import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, Interface, Signer } from "ethers";
import { network } from "hardhat"
import { getGraduatedEvent, getLaunchedEvent } from "./utils";

type DragonSwapAddresses = {
    factory: string;
    router: string;
};

const dragonSwapContracts: Record<string, DragonSwapAddresses> = {
    "testnet": {
        factory: "0xeE6Ad607238f8d2C63767245d78520F06c303D31",
        router: "0x527b42CA5e11370259EcaE68561C14dA415477C8",
    },
};

describe("Bonding Contract", function () {
    let owner: Signer, user: Signer, feeRecipient: Signer;
    let Bonding: Contract, Factory: Contract, Router: Contract, AssetToken: Contract, WSEI: Contract, DragonswapRouter: Contract, DragonswapFactory: Contract;
    let PairAbi: Interface

    let GraduatedToken: string

    before(async function () {
        [owner, user, feeRecipient] = await ethers.getSigners();

        if (!dragonSwapContracts[network.name]) {
            throw new Error("Unsupported network for this test. Please run `npx hardhat test --network <network>` with a network supported in dragonSwapContracts")
        }

        const dragonswapFactory = dragonSwapContracts[network.name].factory
        const dragonswapRouter = dragonSwapContracts[network.name].router

        await network.provider.send("hardhat_setBalance", [
            await user.getAddress(),
            "0xA968163F0A57B4000000", // 500,000 SEI in hex
        ]);
        
        // Deploy a mock ERC20 token to act as the assetToken
        const MockERC20 = await ethers.getContractFactory("FERC20");
        AssetToken = await MockERC20.connect(owner).deploy("Asset Token", "AST", ethers.parseEther("1000000"), ethers.parseEther("1000"));
        await AssetToken.waitForDeployment();

        // Deploy WSEI token
        const WSEIContract = await ethers.getContractFactory("WSEI");
        WSEI = await WSEIContract.connect(owner).deploy();
        await WSEI.waitForDeployment();

        // Deploy Factory contract
        const FFactory = await ethers.getContractFactory("FFactory");
        Factory = await upgrades.deployProxy(FFactory, [await feeRecipient.getAddress(), 5, 5], { initializer: "initialize" });
        await Factory.waitForDeployment();

        // Deploy Router contract
        const FRouter = await ethers.getContractFactory("FRouter");
        Router = await upgrades.deployProxy(FRouter, [Factory.target], { initializer: "initialize" });
        await Router.waitForDeployment();

        const FPair = await ethers.getContractFactory("FPair");
        PairAbi = FPair.interface

        DragonswapRouter = await ethers.getContractAt("IDragonswapRouter", dragonswapRouter);
        DragonswapFactory = await ethers.getContractAt("IDragonswapFactory", dragonswapFactory);


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

        const initialSupply = ethers.parseEther("100000")
        const gradThreshold = ethers.parseEther("25000")
        const maxTx = 20
        // Initialize Bonding contract
        await Bonding.initialize(
            Factory.target,   // factory address
            Router.target,    // router address
            WSEI.target,      // address of WSEI contract that helps us wrap SEI
            await feeRecipient.getAddress(), // fee recipient
            ethers.parseEther("100"),               // asset launch fee amount
            ethers.parseEther("100"),               // sei launch fee amount
            initialSupply, // initial supply
            300,             // assetRate
            maxTx, // maximum percentage of each token that can be bought in one tx.
            gradThreshold, // grad threshold
            dragonswapFactory,
            dragonswapRouter
        );

        await Factory.connect(owner).grantRole(CREATOR_ROLE, Bonding.target);
        await Router.connect(owner).grantRole(EXECUTOR_ROLE, Bonding.target);
    });

    it("should initialize correctly", async function () {
        expect(await Bonding.factory()).to.equal(Factory.target);
        expect(await Bonding.router()).to.equal(Router.target);
    });

    it("should allow owner to set initial supply and graduation threshold", async function () {
        await Bonding.setInitialSupply(ethers.parseEther("1000000000"));
        expect(await Bonding.initialSupply()).to.equal("1000000000000000000000000000");

        await Bonding.setGradThreshold(ethers.parseEther("100000"));
        expect(await Bonding.gradThreshold()).to.equal("100000000000000000000000");
    });

    it("should allow owner to set max tx", async function () {
        await Bonding.setMaxTx(100);
        expect(await Bonding.maxTx()).to.equal("100");
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
        const transferResult = await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("200"))
        await transferResult.wait()

        // User approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("200"));

        // Launch a token
        const tx = await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            ethers.parseEther("200"), // Purchase amount
            AssetToken.target
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
        await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("50"))

        // Approve token transfer.
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("50"));

        // Buy token
        await Bonding.connect(user).buyWithAsset(ethers.parseEther("50"), tokenAddress, AssetToken.target);
        let newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.gt(0);
        let assetTokenBal = await AssetToken.balanceOf(await user.getAddress())
        expect(assetTokenBal).to.be.equal(0);

        // Sell token
        // Approve token transfer.
        const tokensToSell = newTokenBal / BigInt(2)
        await tokenContract.connect(user).approve(Bonding.target, tokensToSell);
        await Bonding.connect(user).sellForAsset(tokensToSell, tokenAddress, AssetToken.target);
        const oldTokenBal = newTokenBal
        newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.lt(oldTokenBal)
        assetTokenBal = await AssetToken.balanceOf(await user.getAddress())
        expect(assetTokenBal).to.be.gt(0);
    });

    it("should dispense less tokens as more buys are performed", async function () {
        // Launch another token
        // Approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        await AssetToken.connect(owner).approve(Bonding.target, ethers.parseEther("200"));

        const tx = await Bonding.connect(owner).launchWithAsset(
            "Another Token",
            "ATT",
            ethers.parseEther("200"), // Purchase amount
            AssetToken.target
        );

        await tx.wait();

        const tokenAddress = (await Bonding.tokenInfos(1)) as string;
        expect(tokenAddress).to.be.properAddress;

        const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);

        // Send user some asset tokens so they can make transfers
        await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("100"))

        // Approve token transfer.
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("50"));

        // Buy token
        await Bonding.connect(user).buyWithAsset(ethers.parseEther("50"), tokenAddress, AssetToken.target);
        let newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.gt(0);


        // Buy more token. The amount received should be less than before
        // Approve more tokens for transfer
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("50"));
        await Bonding.connect(user).buyWithAsset(ethers.parseEther("50"), tokenAddress, AssetToken.target);
        const oldTokenBal = newTokenBal
        newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        const tokensReceivedSecond = newTokenBal - oldTokenBal
        // The number of tokens received from this second sale should be less than the first sale.
        expect(tokensReceivedSecond).to.be.lt(oldTokenBal);
    });

    it("should allow a user to buy and sell tokens using SEI", async function () {
        // First launch a token that has SEI as it's asset token:
        const tx = await Bonding.connect(user).launchWithSEI(
            "Test Sei Token",
            "TSTS",
            {
                value: ethers.parseEther("200"),
            }
        );

        const receipt = await tx.wait();

        const launchEvent = getLaunchedEvent(receipt)
        const tokenAddress = (await Bonding.tokenInfo(launchEvent.args.token)).token as string;
        expect(tokenAddress).to.be.properAddress;

        const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);

        const userAddress = await user.getAddress();

        // Check starting SEI balance
        const startSEIBalance = await ethers.provider.getBalance(userAddress);

        // Buy with SEI
        console.log("Start")
        const buyTx = await Bonding.connect(user).buyWithSEI(tokenAddress, {
            value: ethers.parseEther("10"),
        });
        const buyReceipt = await buyTx.wait();

        let newTokenBal = await tokenContract.balanceOf(userAddress);
        expect(newTokenBal).to.be.gt(0);

        // Check updated SEI balance (less gas + 10 SEI)
        const midSEIBalance = await ethers.provider.getBalance(userAddress);
        expect(midSEIBalance).to.be.lt(startSEIBalance - ethers.parseEther("9")); // Gas overhead

        // Approve token transfer back to router for selling
        await tokenContract.connect(user).approve(Bonding.target, newTokenBal / BigInt(2));

        // Sell tokens for SEI
        const sellTx = await Bonding.connect(user).sellForSEI(newTokenBal / BigInt(2), tokenAddress);
        const sellReceipt = await sellTx.wait();

        const finalTokenBal = await tokenContract.balanceOf(userAddress);
        const endSEIBalance = await ethers.provider.getBalance(userAddress);

        expect(finalTokenBal).to.be.lt(newTokenBal);
        expect(endSEIBalance).to.be.gt(midSEIBalance); // SEI received back

        // Optional: log to see real difference
        console.log("SEI before:", ethers.formatEther(startSEIBalance));
        console.log("SEI after:", ethers.formatEther(endSEIBalance));
    });

    // Test that token graduates and launches pool on Dragonswap once it his threshold
    it("should graduate the token once supply drops below the threshold", async function () {
        const initialSupply = await Bonding.initialSupply()
        console.log("IS", initialSupply)

        const gradThreshold = await Bonding.gradThreshold()
        console.log("GT", gradThreshold)

        // Launch and buy an amount so that the remaining supply is just over the graduation threshold
        const amountToGraduation = ethers.parseEther("5000")
        const buyAmount = gradThreshold - amountToGraduation
        console.log("Buying: ", buyAmount)
        const tx = await Bonding.connect(user).launchWithSEI(
            "GraduateToken",
            "GTK",
            {
                value: buyAmount
            }
        );

        const receipt = await tx.wait();
        const launchedEvent = getLaunchedEvent(receipt)
        GraduatedToken = launchedEvent.args.token as string
        expect(GraduatedToken).to.be.properAddress;

        const pair = new ethers.Contract(launchedEvent.args.pair, PairAbi, user)

        // This buy should cross the threshold and trigger the graduation process
        const buyTx = await Bonding.connect(user).buyWithSEI(GraduatedToken, {
            value: ethers.parseEther("20000"),
        });
        const buyReceipt = await buyTx.wait();

        // Check that token trading is set to false and tradingOnDragonswap is true after graduation
        const tokenInfo = await Bonding.tokenInfo(GraduatedToken)

        expect(tokenInfo.trading).to.be.equal(false)
        expect(tokenInfo.tradingOnDragonswap).to.be.equal(true)

        const graduatedEvent = getGraduatedEvent(buyReceipt)

        const dragonswapPair = await ethers.getContractAt("IDragonswapPair", graduatedEvent.args.pair);

        const token0 = await dragonswapPair.token0()
        const token1 = await dragonswapPair.token1()
        if (tokenInfo.token != token0 && tokenInfo.token != token1) {
            throw new Error("Token Pool deployed should contain the same token")
        }
    })

    // Test that token can no longer be traded on this contract once it is graduated
    it("can no longer be traded via Bonding.sol once graduated", async function () {
        let buySucceeded = false
        try {
            // This buy should cross the threshold and trigger the graduation process
            const buyTx = await Bonding.connect(user).buyWithSEI(GraduatedToken, {
                value: ethers.parseEther("20000"),
            });
            const buyReceipt = await buyTx.wait();
            buySucceeded = true
        } catch {
            
        }
        expect(buySucceeded).to.be.equal(false);
    })

    // Test that liquidity and price on Dragonswap should be exactly the same as on the private AMM
    it ("should not have a drastic price change after graduation", async function () {
        const testAmount = ethers.parseEther("1")
        const oldPrice = await Router.getAmountsOut(await WSEI.getAddress(), GraduatedToken, testAmount)
        console.log("REST", oldPrice)

        const newPrice = await DragonswapRouter.getAmountOut(testAmount, await DragonswapRouter.WSEI(), GraduatedToken)
        console.log("RESS", newPrice)
    })

    // Test that we should only be able to launch some token with either SEI or ASSET

    // Test deployment fees

    // Test taxes on deployed pools?

    // Test max tx (max percentage of token that can be bought at once)
});
