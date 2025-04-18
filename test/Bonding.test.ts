import {expect} from "chai";
import {ethers, network, upgrades} from "hardhat";
import {Interface, Signer} from "ethers";
import {
    calculateAmountOutForBuy, calculateAmountOutForSell,
    formatBalance,
    getGraduatedEvent,
    getLaunchedEvent,
    getLaunchedTokenAndPairContracts
} from "./utils";
import {
    Bonding,
    FERC20,
    FFactory,
    FRouter,
    IDragonswapFactory,
    IDragonswapRouter,
    WSEI,
} from "../typechain-types";

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

const BUY_TAX = 5;
const SELL_TAX = 10;
const SEI_LAUNCH_FEE = ethers.parseEther("100");
const ASSET_LAUNCH_FEE = ethers.parseEther("200");
const MAX_TX = 20;
const INITIAL_SUPPLY = ethers.parseEther("100000");
const GRAD_THRESHOLD = ethers.parseEther("25000");
const MULTIPLIER = 5000;


describe("Bonding Contract", function () {
    let owner: Signer, user: Signer, feeRecipient: Signer;
    let Bonding: Bonding, Factory: FFactory, Router: FRouter, AssetToken: FERC20, WSEI: WSEI, DragonswapRouter: IDragonswapRouter, DragonswapFactory: IDragonswapFactory;
    let PairAbi: Interface
    let GraduatedToken: string, AssetTradedToken: string, AssetTradedPair: string;

    before(async function () {
        [owner, user, feeRecipient] = await ethers.getSigners();

        if (!dragonSwapContracts[network.name]) {
            throw new Error("Unsupported network for this test. Please run `npx hardhat test --network <network>` with a network supported in dragonSwapContracts")
        }

        const dragonswapFactory = dragonSwapContracts[network.name].factory
        const dragonswapRouter = dragonSwapContracts[network.name].router

        await network.provider.send("hardhat_setBalance", [
            await user.getAddress(),
            "0xA968163F0A57B400000000", // 500,000,000 SEI in hex
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
        Factory = await upgrades.deployProxy(FFactory, [await feeRecipient.getAddress(), BUY_TAX, SELL_TAX, MULTIPLIER], { initializer: "initialize" });
        await Factory.waitForDeployment();

        // Deploy Router contract
        const FRouter = await ethers.getContractFactory("FRouter");
        Router = await upgrades.deployProxy(FRouter, [Factory.target], { initializer: "initialize" });
        await Router.waitForDeployment();

        const SyntheticPair = await ethers.getContractFactory("SyntheticPair");
        PairAbi = SyntheticPair.interface

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

        // Initialize Bonding contract
        await Bonding.initialize(
            Factory.target,   // factory address
            Router.target,    // router address
            WSEI.target,      // address of WSEI contract that helps us wrap SEI
            ASSET_LAUNCH_FEE,               // asset launch fee amount
            SEI_LAUNCH_FEE,               // sei launch fee amount
            INITIAL_SUPPLY, // initial supply
            MAX_TX, // maximum percentage of each token that can be bought in one tx.
            GRAD_THRESHOLD, // sei grad threshold
            GRAD_THRESHOLD, // asset grad threshold
            100, // Sets the dragonswap tax bps (100 is 1%)
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

        await Bonding.setSeiGradThreshold(ethers.parseEther("100000"));
        expect(await Bonding.seiGradThreshold()).to.equal("100000000000000000000000");

        await Bonding.setAssetGradThreshold(ethers.parseEther("100000"));
        expect(await Bonding.assetGradThreshold()).to.equal("100000000000000000000000");
    });

    it("should allow owner to set max tx", async function () {
        await Bonding.setMaxTx(100);
        expect(await Bonding.maxTx()).to.equal("100");
    });

    it('Shouldnt allow user to to set initial supply and graduation threshold', async function(){

        await expect(Bonding.connect(user).setInitialSupply(ethers.parseEther("1000000000")))
            .to.be.reverted;

        await expect(Bonding.connect(user).setSeiGradThreshold(ethers.parseEther("100000")))
            .to.be.reverted;

        await expect(Bonding.connect(user).setAssetGradThreshold(ethers.parseEther("100000")))
            .to.be.reverted;
    });

    it('Shouldnt allow user to set max tx', async function(){
        await expect(Bonding.connect(user).setMaxTx(ethers.parseEther('100')))
            .to.be.reverted;
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

    it("should allow user to launch a token with asset amount equal to launch fee", async function () {
        await Bonding.setInitialSupply(INITIAL_SUPPLY);
        await Bonding.setSeiGradThreshold(GRAD_THRESHOLD);
        await Bonding.setAssetGradThreshold(GRAD_THRESHOLD);

        // Send some token from owner to user
        const initialPurchase = await Bonding.assetLaunchFee();
        const transferResult = await AssetToken.connect(owner).transfer(await user.getAddress(), initialPurchase)
        await transferResult.wait();
        // User approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        const approveResult = await AssetToken.connect(user).approve(Bonding.target, initialPurchase);
        await approveResult.wait();

        // Launch a token
        const tx = await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            initialPurchase, // Purchase amount
            AssetToken.target
        );

        const filter = Bonding.filters.Launched();
        const events = await Bonding.queryFilter(filter, "latest");

        expect(events.length).to.be.greaterThan(0);
        expect(events[0].args.token).to.be.properAddress;
        expect(events[0].args.pair).to.be.properAddress;

        AssetTradedToken = events[0].args.token
        AssetTradedPair = events[0].args.pair

        // Since the input amount is equal to launch fee, the user should receive no token.
        const tokenContract = await ethers.getContractAt("FERC20", AssetTradedToken, user);
        const currBal = await tokenContract.balanceOf(await user.getAddress())
        expect(currBal).to.be.equals(0);
    });

    it('Shouldnt allow a user to launch a token with asset amount less than launch fee', async function (){
        const lessThanLaunchFee = ethers.parseEther((formatBalance(await Bonding.assetLaunchFee()) - 1).toString());
        const transferResult = await AssetToken.connect(owner).transfer(await user.getAddress(), lessThanLaunchFee)
        await transferResult.wait();
        // User approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        const approveResult = await AssetToken.connect(user).approve(Bonding.target, lessThanLaunchFee);
        await approveResult.wait();

        await expect(Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            lessThanLaunchFee,
            AssetToken.target
        )).to.be.revertedWith("Purchase amount must be greater than or equal to fee");
    });

    it('Should perform a buy if the launch amount is higher than the launch fee', async function (){
        const moreThanFeeAmount = 100;
        const moreThanLaunchFee = ethers.parseEther((formatBalance(await Bonding.assetLaunchFee())
            + moreThanFeeAmount).toString());

        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), moreThanLaunchFee)
        await transferResult.wait();
        // User approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        const approveResult = await AssetToken.connect(user)
            .approve(Bonding.target, moreThanLaunchFee);
        await approveResult.wait();

        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            moreThanLaunchFee,
            AssetToken.target
        );

        const {launchedTokenContract} = await getLaunchedTokenAndPairContracts(Bonding);
        const launcherAfterBalance = await launchedTokenContract.balanceOf(await user.getAddress());
        const expectedAmountOfToken = calculateAmountOutForBuy(moreThanFeeAmount, ASSET_LAUNCH_FEE, INITIAL_SUPPLY, MULTIPLIER, BUY_TAX);

        expect(formatBalance(launcherAfterBalance)).to.be.equal(expectedAmountOfToken);
    });

    it('Should allow a launch that directly exceeds grad threshold', async function (){
        const expectedOverGradAmount = formatBalance(GRAD_THRESHOLD) + formatBalance(ASSET_LAUNCH_FEE);
        const launchAmountWithTax = ethers.parseEther(((expectedOverGradAmount / (1 - (BUY_TAX/100)) + 5).toString()));

        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), launchAmountWithTax)
        await transferResult.wait();

        await AssetToken.connect(user).approve(Bonding.target, launchAmountWithTax);
        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            launchAmountWithTax,
            AssetToken.target
        );
        const {launchedTokenContract, syntheticPairContract} = await getLaunchedTokenAndPairContracts(Bonding);
        const [tokenReserve, assetReserve] = await syntheticPairContract.getReserves();
        expect(formatBalance(tokenReserve)).to.be.equal(0);
        expect(formatBalance(assetReserve)).to.be.equal(0);

        const tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        expect(tokenInfo.trading).to.be.false;
        expect(tokenInfo.tradingOnDragonswap).to.be.true;
    });

    it('Token info returns correct information about launched token', async function (){
        const launchAmount = ethers.parseEther('500');
        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), launchAmount)
        await transferResult.wait();

        await AssetToken.connect(user).approve(Bonding.target, launchAmount);
        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            launchAmount,
            AssetToken.target
        );
        const {launchedTokenContract, syntheticPairContract} = await getLaunchedTokenAndPairContracts(Bonding);
        const tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        expect(tokenInfo.creator).to.be.eq(await user.getAddress());
        expect(tokenInfo.token).to.be.eq(launchedTokenContract.target);
        expect(tokenInfo.pair).to.be.eq(syntheticPairContract.target);
        expect(tokenInfo.trading).to.be.true;
        expect(tokenInfo.tradingOnDragonswap).to.be.false;

        const tokenData = tokenInfo.data;
        expect(tokenData.supply).to.be.eq(INITIAL_SUPPLY);
        expect(tokenData.token).to.be.eq(launchedTokenContract.target);
        expect(tokenData.name).to.be.eq("aiden Test Token");
    });

    it('Token info correctly tracks volume with buy and sell operations', async function (){
        const launchAmount = ethers.parseEther('200');
        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), launchAmount)
        await transferResult.wait();

        await AssetToken.connect(user).approve(Bonding.target, launchAmount);
        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            launchAmount,
            AssetToken.target
        );

        const {launchedTokenContract, syntheticPairContract} = await getLaunchedTokenAndPairContracts(Bonding);
        let tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        //Since no buy current volume should be 0
        expect(tokenInfo.data.volume).to.be.eq(0);

        //Owner buys for 20 asset token. Minus fee it should be 19 volume now
        await AssetToken.approve(Bonding.target, ethers.parseEther('20'));
        await Bonding.buyWithAsset(ethers.parseEther('20'), launchedTokenContract.target, AssetToken.target);
        tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        expect(tokenInfo.data.volume).to.be.eq(ethers.parseEther('19'));

        //Owner sells for 1 launched token
        const [tokenBalance, assetBalance ] = await syntheticPairContract.getReserves();
        const ownerPreBalance = await AssetToken.balanceOf(await owner.getAddress());
        const expectedReturnAmount = calculateAmountOutForSell(1, tokenBalance, assetBalance, MULTIPLIER, SELL_TAX);

        await launchedTokenContract.approve(Bonding.target, ethers.parseEther('10'));
        await Bonding.sellForAsset(ethers.parseEther('1'), launchedTokenContract.target, AssetToken.target);
        const ownerAfterBalance = await AssetToken.balanceOf(await owner.getAddress());

        //Validate sell amount with multiplier
        const receivedAssetAmount = formatBalance(ownerAfterBalance) - formatBalance(ownerPreBalance);
        expect(receivedAssetAmount.toFixed(5)).to.be.equal(expectedReturnAmount.toString());
        tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        const expectedVolumeAmount = calculateAmountOutForSell(1, tokenBalance, assetBalance, MULTIPLIER, SELL_TAX);
        expect(Math.abs(formatBalance(tokenInfo.data.volume) - (expectedVolumeAmount + 19))).to.be.within(0.5, 1.5);
    });

    it('Token info returns correct price', async function (){
        const launchAmount = ethers.parseEther('400');
        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), launchAmount)
        await transferResult.wait();

        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther('1000'));
        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            launchAmount,
            AssetToken.target
        );

        const {launchedTokenContract, syntheticPairContract} = await getLaunchedTokenAndPairContracts(Bonding);
        const initialPrice = calculateAmountOutForSell(1, INITIAL_SUPPLY, launchAmount, MULTIPLIER, 1);
        let tokenInfo = await Bonding.tokenInfo(launchedTokenContract.target);
        expect(Math.abs(formatBalance(tokenInfo.data.price) - initialPrice)).to.be.within(0, 0.4);

        //After a buy price is correct with multiplier
        await Bonding.connect(user).buyWithAsset(ethers.parseEther('10'), launchedTokenContract.target, AssetToken.target);
        const [tokenBalance, assetBalance ] = await syntheticPairContract.getReserves();
        const intermediatePrice = calculateAmountOutForSell(1, tokenBalance, assetBalance, MULTIPLIER, 1);
        const priceAfterBuy = await Bonding.tokenInfo(launchedTokenContract.target);
        expect(Math.abs(formatBalance(priceAfterBuy.data.price) - intermediatePrice)).to.be.within(0, 0.4);
    });

    it('Updating grad threshold on existing pools doesnt cause pools to be graduated', async function (){
        // Existing threshold is 25000
        const launchAmount = ethers.parseEther('400');
        const transferResult = await AssetToken.connect(owner)
            .transfer(await user.getAddress(), launchAmount)
        await transferResult.wait();

        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther('1000'));
        await Bonding.connect(user).launchWithAsset(
            "Test Token",
            "TST",
            launchAmount,
            AssetToken.target
        );

        const {launchedTokenContract, syntheticPairContract} = await getLaunchedTokenAndPairContracts(Bonding);
        await Bonding.setAssetGradThreshold(ethers.parseEther('300'));
        let tokenInfo = await Bonding.tokenInfo(launchedTokenContract);
        expect(tokenInfo.trading).to.be.true;

        //Next trade sends it to graduated
        await Bonding.connect(user).buyWithAsset(ethers.parseEther('10'), launchedTokenContract.target, AssetToken.target);
        tokenInfo = await Bonding.tokenInfo(launchedTokenContract);
        expect(tokenInfo.trading).to.be.false;

        //Reserves are empty
        const [tokenBalance, assetBalance ] = await syntheticPairContract.getReserves();
        expect(tokenBalance).to.be.eq(0);
        expect(assetBalance).to.be.eq(0);

        await Bonding.setAssetGradThreshold(ethers.parseEther('25000'));
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
        let oldTokenBal = await AssetToken.balanceOf(await user.getAddress())
        let buyAmt = ethers.parseEther("50")
        await Bonding.connect(user).buyWithAsset(buyAmt, tokenAddress, AssetToken.target);
        let newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.gt(0);
        let assetTokenBal = await AssetToken.balanceOf(await user.getAddress())
        expect(oldTokenBal - assetTokenBal).to.be.equals(buyAmt);

        // Sell token
        // Approve token transfer.
        const tokensToSell = newTokenBal / BigInt(2)
        await tokenContract.connect(user).approve(Bonding.target, tokensToSell);
        await Bonding.connect(user).sellForAsset(tokensToSell, tokenAddress, AssetToken.target);
        oldTokenBal = newTokenBal
        newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        expect(newTokenBal).to.be.lt(oldTokenBal)
        assetTokenBal = await AssetToken.balanceOf(await user.getAddress())
        expect(assetTokenBal).to.be.gt(0);
    });

    it("should dispense less tokens as more buys are performed", async function () {
        // Launch another token
        // Approves Bonding contract to spend AssetToken so it can seed the liquidity pool with the initial purchase.
        const launchFee = await Bonding.assetLaunchFee();
        await AssetToken.connect(owner).approve(Bonding.target, launchFee);

        const tx = await Bonding.connect(owner).launchWithAsset(
            "Another Token",
            "ATT",
            launchFee, // Purchase amount
            AssetToken.target
        );

        const receipt = await tx.wait();
        const launchEvent = getLaunchedEvent(receipt)
        const pairAddress = launchEvent.args.pair;
        const tokenAddress = launchEvent.args.token;
        expect(tokenAddress).to.be.properAddress;

        const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);

        // Send user some asset tokens so they can make transfers
        await AssetToken.connect(owner).transfer(await user.getAddress(), ethers.parseEther("100"))

        // Approve token transfer.
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("50"));

        // Buy token
        const pair = await ethers.getContractAt("SyntheticPair", pairAddress, user)
        let price = await pair.getTokenPrice()
        await Bonding.connect(user).buyWithAsset(ethers.parseEther("50"), tokenAddress, AssetToken.target);
        let newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        
        expect(newTokenBal).to.be.gt(0);

        let oldPrice = price
        price = await pair.getTokenPrice()
        expect(price).to.be.greaterThan(oldPrice)

        // Buy more token. The amount received should be less than before
        // Approve more tokens for transfer
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("50"));
        await Bonding.connect(user).buyWithAsset(ethers.parseEther("50"), tokenAddress, AssetToken.target);
        let oldTokenBal = newTokenBal
        newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        const tokensReceivedSecond = newTokenBal - oldTokenBal
        // The number of tokens received from this second sale should be less than the first sale.
        expect(tokensReceivedSecond).to.be.lt(oldTokenBal);

        oldPrice = price
        price = await pair.getTokenPrice()
        expect(price).to.be.greaterThan(oldPrice)

        // Expect that the price reflected is correct.
        const currentAssetBalance = await AssetToken.balanceOf(await user.getAddress())
        await AssetToken.connect(user).approve(Bonding.target, price);
        await Bonding.connect(user).buyWithAsset(price, tokenAddress, AssetToken.target);
        
        oldTokenBal = newTokenBal
        newTokenBal = await tokenContract.balanceOf(await user.getAddress())
        const diff = newTokenBal - oldTokenBal

        // User should have gotten about 1 token (assuming token also has 18 decimal places)
        // We give slippage about 10%
        expect(diff).to.be.greaterThan(ethers.parseEther("0.90"))
        expect(diff).to.be.lessThan(ethers.parseEther("1.1"))
    });

    it("should allow a user to buy and sell tokens using SEI", async function () {
        // First launch a token that has SEI as it's asset token:
        const launchFee = await Bonding.seiLaunchFee();
        const tx = await Bonding.connect(user).launchWithSei(
            "Test Sei Token",
            "TSTS",
            {
                value: launchFee,
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
        const buyTx = await Bonding.connect(user).buyWithSei(tokenAddress, {
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
        const sellTx = await Bonding.connect(user).sellForSei(newTokenBal / BigInt(2), tokenAddress);
        const sellReceipt = await sellTx.wait();

        const finalTokenBal = await tokenContract.balanceOf(userAddress);
        const endSEIBalance = await ethers.provider.getBalance(userAddress);

        expect(finalTokenBal).to.be.lt(newTokenBal);
        expect(endSEIBalance).to.be.gt(midSEIBalance); // SEI received back
    });

    // Test that fees are deducted on buys and sells
    it("should deduct fees on launch and tax on buys and sells", async function () {
        const buyTax = await Factory.buyTax();
        const taxVault = await Factory.taxVault();
        const launchFee = await Bonding.seiLaunchFee();

        const transferResult = await AssetToken.connect(owner).transfer(await user.getAddress(), launchFee)
        transferResult.wait();
        await AssetToken.connect(user).approve(Bonding.target, ethers.parseEther("100"));

        const pair = await ethers.getContractAt("SyntheticPair", AssetTradedPair, user)
        const before = await pair.assetBalance()
        const buyAmount = ethers.parseEther("100")
        const tx = await Bonding.connect(user).buyWithAsset(buyAmount, AssetTradedToken, AssetToken.target);
        tx.wait();

        const after = await pair.assetBalance()

        // Expect that the amount of tokens deposited into the pool is equal to buyAmount reduced by buyTax percent
        expect(after - before).to.be.equals(buyAmount * (100n - buyTax) / 100n)
    })


    // Test that token graduates and launches pool on Dragonswap once it his threshold
    it("should graduate the token once supply drops below the threshold", async function () {
        const gradThreshold = await Bonding.seiGradThreshold()

        // Launch and buy an amount so that the asset supply is just under the graduation threshold (reduced by fees)
        const buyAmount = gradThreshold
        const tx = await Bonding.connect(user).launchWithSei(
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
        let assetReserve = await pair.assetBalance();

        const oldPrice = await Router.getAmountOut(await WSEI.getAddress(), GraduatedToken, ethers.parseEther("1"))

        // This buy should cross the threshold and trigger the graduation process
        const buyTx = await Bonding.connect(user).buyWithSei(GraduatedToken, {
            value: (gradThreshold - assetReserve) * BigInt(2),
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

        // Check that pair doesn't hold anymore tokens
        assetReserve = await pair.assetBalance();
        const tokenReserve = await pair.balance();
        expect(assetReserve).to.be.equals(0)
        expect(tokenReserve).to.be.equals(0)

        // Check that price is not trading too differently from the previous price
        const path = [await DragonswapRouter.WSEI(), GraduatedToken];
        const amounts = await DragonswapRouter.getAmountsOut(ethers.parseEther("1"), path);
        const newPrice = amounts[1]; // The result after the swap
        expect(oldPrice-newPrice).to.be.lessThan(ethers.parseEther('10'))
    })

    // Test that token can no longer be traded on this contract once it is graduated
    it("can no longer be traded via Bonding.sol once graduated", async function () {
        let buySucceeded = false
        try {
            // This buy should fail since the token is no longer trading
            const buyTx = await Bonding.connect(user).buyWithSei(GraduatedToken, {
                value: ethers.parseEther("20000"),
            });
            const buyReceipt = await buyTx.wait();
            buySucceeded = true
        } catch {
            
        }
        expect(buySucceeded).to.be.equal(false);
    })

    // Test taxes on deployed pools?

    // Test max tx (max percentage of token that can be bought at once)
    it("Should limit the amount of token that can be traded based on maxTx", async function () {
        const maxPercentage = 10;
        await Bonding.setMaxTx(maxPercentage);
        expect(await Bonding.maxTx()).to.equal(maxPercentage);
        await Bonding.setInitialSupply(ethers.parseEther("1000000000"));
        await Bonding.setSeiGradThreshold(ethers.parseEther("100000"));

        const maxLaunchInput = await Bonding.getMaxLaunchInputSei();
        console.log("maximum", ethers.formatEther(maxLaunchInput));

        // Launch token with a large initial purchase - this should fail
        try {
            const tx = await Bonding.connect(user).launchWithSei(
                "LimitedToken",
                "LMT",
                {
                    value: maxLaunchInput + ethers.parseEther("1")
                }
            );
    
            await tx.wait();
            expect.fail("Expected transaction to revert with 'Exceeds MaxTx', but it succeeded");
        } catch (error: any) {
            // Expect that the revert reason should have the error message "Exceeds MaxTx"
            const revertReason = error?.error?.message || error?.reason || error?.message;
            console.log("Full reason", revertReason)
            expect(revertReason).to.contain("Exceeds MaxTx")
        }

        // Now launch the token normally
        const tx = await Bonding.connect(user).launchWithSei(
            "LimitedToken",
            "LMT",
            {
                value: maxLaunchInput
            }
        );

        const receipt = await tx.wait();

        const launchEvent = getLaunchedEvent(receipt)
        const tokenAddress = launchEvent.args.token;
        expect(tokenAddress).to.be.properAddress;

        // Test that there is a maximum limit to the buy amount
        const maxBuy = await Bonding.getMaxBuyInputSei(tokenAddress)
        try {
            const buyTx = await Bonding.connect(user).buyWithSei(tokenAddress, {
                value: maxBuy + ethers.parseEther("1"),
            });

            await buyTx.wait();
            expect.fail("Expected transaction to revert with 'Exceeds MaxTx', but it succeeded");
        } catch (error: any) {
            // Expect that the revert reason should have the error message "Exceeds MaxTx"
            const revertReason = error?.error?.message || error?.reason || error?.message;
            console.log("Full reason", revertReason)
            expect(revertReason).to.contain("Exceeds MaxTx")
        }

        // Test that we are good if we buy the exact limit
        const buyTx = await Bonding.connect(user).buyWithSei(tokenAddress, {
            value: maxBuy,
        });

        buyTx.wait();
    })

    // Test how much token 100000 SEI buys, as a proportion of total supply
    it("Should sell a reasonable percentage of token for 100000 SEI", async function () {
        const maxPercentage = 100
        await Bonding.setMaxTx(maxPercentage);
        expect(await Bonding.maxTx()).to.equal(maxPercentage);
        const launchFee = await Bonding.seiLaunchFee();
        
        // Launch token
        const tx = await Bonding.connect(user).launchWithSei(
            "SomeToken",
            "SMT",
            {
                value: launchFee
            }
        );

        const receipt = await tx.wait();

        const launchEvent = getLaunchedEvent(receipt)
        const tokenAddress = launchEvent.args.token;
        expect(tokenAddress).to.be.properAddress;

        // See how much token we own after buying 100000 SEI worth
        const buyTax = await Factory.buyTax();

        const amountToBuy = 100000n * (100n / (100n - buyTax))
        const buyTx = await Bonding.connect(user).buyWithSei(tokenAddress, {
            value: ethers.parseEther(amountToBuy.toString()),
        });

        buyTx.wait();

        const tokenContract = await ethers.getContractAt("FERC20", tokenAddress);
        const tokenBalance = await tokenContract.balanceOf(await user.getAddress());
        console.log("tokenBalance", tokenBalance)

        const totalSupply = await tokenContract.totalSupply();
        console.log("totalSupply", totalSupply);
        console.log("percentage", (tokenBalance*100n)/totalSupply)
        
    })
});
