import {BigNumberish, Interface, Log} from "ethers";
import {Bonding} from "../typechain-types";
import {ethers} from "hardhat";

export const getLaunchedEvent = (receipt: any): any => {

    const abi = [
        "event Launched(address indexed token, address indexed pair, uint256)"
    ];
    const iface = new Interface(abi);

    // Get the topic hash for the event
    const eventFound = iface.getEvent("Launched");

    if (!eventFound) {
        return
    }
    
    // Search for the matching log
    const launchedLog = receipt.logs.find(
        (log: Log) => log.topics[0] === eventFound.topicHash
    );

    if (!launchedLog) {
        console.error("Launched event not found");
    } else {
        const parsed = iface.parseLog(launchedLog);
        return parsed
    }
}

export const getGraduatedEvent = (receipt: any): any => {

    const abi = [
        "event Graduated(address indexed token, address indexed pair)"
    ];
    const iface = new Interface(abi);

    // Get the topic hash for the event
    const eventFound = iface.getEvent("Graduated");

    if (!eventFound) {
        return
    }
    // Search for the matching log
    const log = receipt.logs.find(
        (log: Log) => log.topics[0] === eventFound.topicHash
    );

    if (!log) {
        console.error("Graduated event not found");
        console.log(receipt.logs)
    } else {
        const parsed = iface.parseLog(log);
        return parsed
    }
}

export const formatBalance = (balance: BigNumberish): number => {
    const etherString = ethers.formatEther(balance);
    const etherValue = parseFloat(etherString);
    return parseFloat(etherValue.toFixed(5));
};

export const calculateAmountOutForBuy = (
    amountIn: number,
    inReserve: BigNumberish,
    outReserve: BigNumberish,
    multiplier: number,
    buyTax: number
): number => {
    amountIn = amountIn * (1 - (buyTax / 100));
    const reserveIn =  multiplier * parseFloat(ethers.formatEther(inReserve));
    const reserveOut = parseFloat(ethers.formatEther(outReserve));
    const amountOut = (reserveOut * amountIn) / (amountIn + reserveIn);
    return parseFloat(amountOut.toFixed(5));
};

export const calculateAmountOutForSell = (
    amountIn: number,
    inReserve: BigNumberish,
    outReserve: BigNumberish,
    multiplier: number,
    sellTax: number
) => {
    const reserveIn =  parseFloat(ethers.formatEther(inReserve));
    const reserveOut = multiplier * parseFloat(ethers.formatEther(outReserve));
    const amountOut = (reserveOut * amountIn) / (amountIn + reserveIn);
    return parseFloat((amountOut - (amountOut * (sellTax / 100))).toFixed(5));
}

export function calculateAmountInForExactOutput(amountOut: number, inReserve: BigNumberish, outReserve: BigNumberish, multiplier: number, tax: number){
    const reserveIn = multiplier * parseFloat(ethers.formatEther(inReserve));
    const reserveOut = parseFloat(ethers.formatEther(outReserve));

    if (amountOut >= reserveOut) {
        throw new Error("Desired output amount must be less than the available output reserve");
    }
    const netAmountIn = (amountOut * reserveIn) / (reserveOut - amountOut);
    const amountIn = netAmountIn / (1 - (tax/100));
    return parseFloat(amountIn.toFixed(5));
}

export async function getLaunchedTokenAndPairContracts(contract: Bonding){
    const filter = contract.filters.Launched();
    const events = await contract.queryFilter(filter, "latest");
    const parsedEvents = contract.interface.parseLog(events[0]);
    const launchedTokenContract = await ethers.getContractAt("ERC20", parsedEvents!.args.token);
    const syntheticPairContract = await ethers.getContractAt("SyntheticPair", parsedEvents!.args.pair);
    return {launchedTokenContract, syntheticPairContract};
}