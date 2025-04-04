# launchpad-contracts

This repo contains contracts used for a fair token launch mechanism

## Getting Started

1. Install dependencies by running `npm install`

2. In order to compile the contracts, run `npx hardhat compile`. This outputs contracts in the artifacts directory

## Testing
1. To add tests, you can add tests to `./test`. Refer to `Bonding.test.ts` as an example.

2. This framework relies on access to dragonswap contracts on testnet. Spin up a local fork of testnet by running `npx hardhat node --fork https://evm-rpc-testnet.sei-apis.com`

3. To run your tests, run `npx hardhat test` to run all tests, or run `npx hardhat test <path_to_test>` to run a specific test.

## Contracts and Architecture

To deploy these contracts, you would need to deploy, in order,
1. WSEI Contract
2. AssetToken (If using an underlying token other than SEI)
3. FFactory Contract
4. Router Contract
5. Bonding Contract.

TODO: Should probably provide a script here to deploy these sequentially on a chosen network and return the addresses.

## Calling the contracts

The primary interface for these contracts is Bonding.sol, which supports 3 main features
1. Launching a token
- launchWithAsset: Launches a token that trades against a given asset token
- launchWithSei: Launches a token that trades against SEI

2. Buying a token
- buyWithAsset: Buys a token using the given asset token - this token must have been launched using launchWithAsset
- buyWithSei: Buys a token using SEI - this token must have been launched using launchWithSei

3. Selling a token
- sellForAsset: Sells a token using the given asset token - this token must have been launched using launchWithAsset
- sellForSei: Sells a token using SEI - this token must have been launched using launchWithSei

The Bonding.sol contract must be initialized with parameters that can later be changed:
```solidity
function initialize(
        address factory_, // The address of the FFactory contract
        address router_, // The address of the FRouter contract
        address payable wsei_, // The address of some wsei contract that wraps SEI as an ERC20 token
        uint256 assetLaunchFee_, // The fee required to launch a token that pairs with an asset. This fee is used as the initial liquidity in the pool.
        uint256 seiLaunchFee_, // The fee required to launch a token that pairs with SEI. This fee is used as the initial liquidity in the pool.
        uint256 initialSupply_, // The initial supply of each token on launch.
        uint256 maxTx_, // A limit on the percentage of total supply of the token that can be bought in one transaction
        uint256 seiGradThreshold_, // The amount of SEI a token pair must receive before it graduates to dragonswap
        uint256 assetGradThreshold_, // The amount of some asset token a token pair must receive before it graduates to dragonswap
        uint256 dragonswapTaxBps_, // The tax on swaps to and from a dragonswap pool (post graduation), in Basis Points (100 = 1%)
        address dragonswapFactory_, // The address of the dragonswap factory
        address dragonswapRouter_ // The address of the dragonswap router
    )
```
## How it works
Under the hood, the bonding curve is enforced using a standard Automated Market Maker (AMM) pair, which follows the formula `k = yx`.

On launch, a private AMM pair is created. 100% of the new token supply is deposited and paired with the launchFee. In order to reduce volatility, there is also an option to set a `multiplier` on each pool (Configured in the FFactory contract), which decreases volatility and increases the price of the token by multipliying the amount of assetToken or SEI in each pool for the purpose of price calculation.

Buys and Sells go through the FRouter contract. There is an option to configure a buyTax and sellTax in the FRouter contract that allows some tax recipient to take a cut of assetToken/SEI on each buy and sell.

For buys and sells using SEI, the SEI sent by the user is implicitly wrapped using the provided `wsei` contract.

For buys and sells using some assetToken, the user must first approve the use of the assetToken by the Bonding.sol contract.

When the token hits the `gradThreshold`, a few things happen:
1. The entire pool for the token is emptied out and sent to the router contract.
2. A new pool is launched on dragonswap between the token and SEI/assetToken
3. All the SEI/assetToken is deposited into this new dragonswap pool
4. A corresponding amount of Token is added into the new dragonswap pool (The amount of token calculated will keep the price of the token on the Dragonswap Pool similar to that of the bonding curve)
5. Any remaining token is burnt (We do not maintain a treasury or DAO)
6. Futher trading of this token will cease. All future trades should be with Dragonswap.
