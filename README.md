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

## Deployment Script

```bash
npx hardhat ignition deploy ignition/modules/AIDEN.ts --network testnet
```
