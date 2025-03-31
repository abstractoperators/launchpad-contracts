import { Interface, Log } from "ethers";

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