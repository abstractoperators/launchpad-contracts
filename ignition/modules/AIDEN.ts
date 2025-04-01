import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AIDEN", (m) => {
  const wsei = m.contract("WSEI", []);

//   m.call(wsei, "withdraw", [1]);

  return { wsei };
});