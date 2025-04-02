import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";
import { network } from "hardhat";
import { upgrades } from "hardhat";

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

// TODO: Upgradeable contracts
export default buildModule("AIDEN", async (m) => {
  if (!dragonSwapContracts[network.name]) {
    throw new Error(`DragonSwap contracts not found for network: ${network.name}`);
  }

  // Only deploy non-upgradable contracts through ignition
  const wsei = m.contract("WSEI", []); 
  // const factory = m.contract("FFactory", []);
  // const router = m.contract("FRouter", []);
  // const bonding = m.contract("Bonding", []);
  const BondingFactory = await ethers.getContractFactory("Bonding");
  const bonding = await upgrades.deployProxy(BondingFactory, [], { initialize: false });
  await bonding.deployed();

  const assetLaunchFee = ethers.parseEther("100"); // 100 AIDEN asset
  const seiLaunchFee = ethers.parseEther("100"); //100 wsei
  const initialSupply = ethers.parseEther("100000");
  const maxTx = 20;
  const seiGradThreshold = ethers.parseEther("25000");
  const assetGradThreshold = ethers.parseEther("25000");
  const dragonSwapTaxBps = 100; // 1% tax


  m.call(bonding, "initialize", [
    factory, //claude said that ignition would resolve the address
    // This guy also says it works https://ethereum.stackexchange.com/a/164202
    router,
    wsei,
    assetLaunchFee,
    seiLaunchFee,
    initialSupply,
    maxTx,
    seiGradThreshold,
    assetGradThreshold,
    dragonSwapTaxBps,
    dragonSwapContracts[network.name].factory,
    dragonSwapContracts[network.name].router
  ]
  );


  return { wsei, factory, router, bonding };
});