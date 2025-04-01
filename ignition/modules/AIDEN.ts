import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AIDEN", (m) => {
  const wsei = m.contract("WSEI", []);
  const ffactory = m.contract("FFactory", []);
  const router = m.contract("FRouter", []);
  const bonding = m.contract("Bonding", []);

  // const 

//   m.call(wsei, "withdraw", [1]);

  return { wsei };
});